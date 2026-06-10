import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import z from 'zod';
import path from 'path';
import fs from 'fs/promises';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('../../package.json');
import { generateId } from 'melony';
import { DEFAULT_BASE_DIR, loadConfig, resolvePath } from '../app/config.js';
import { ActiveRunsSnapshotEvent, OpenBotEvent, OpenBotState } from './types.js';
import { processService } from '../services/process.js';
import { runAgent, STATE_AGENT_ID, ORCHESTRATOR_AGENT_ID } from '../harness/index.js';
import { initPlugins } from '../services/plugins/registry.js';
import { storageService } from '../plugins/storage/service.js';
import {
  buildWorkspaceFileUrl,
  getPublicBaseUrl,
  openChannelFileStream,
} from '../plugins/storage/files.js';
import { ensureEventId, openBotEventFromQuery } from './utils.js';
import { abortRegistry, abortKey } from '../services/abort.js';

type Bucket = { channelId: string; threadId?: string; activeCount: number; agentIds: Set<string> };

export interface ServerOptions {
  port?: number;
}

export async function startServer(options: ServerOptions = {}) {
  const publishEventSchema = z
    .object({
      id: z.string().optional(),
      type: z.string().min(1, 'Event type is required'),
      data: z.unknown().optional(),
      meta: z.unknown().optional(),
    })
    .passthrough();

  const config = loadConfig();
  processService.syncWorkspaceVariablesToProcessEnv();

  const baseDir = config.baseDir || DEFAULT_BASE_DIR;
  const openBotDir = resolvePath(baseDir);
  const PORT = Number(options.port ?? config.port ?? process.env.PORT ?? 4132);
  const app = express();
  const clients: Map<string, express.Response[]> = new Map();
  const GLOBAL_CHANNEL_ID = '__global__';
  const activeRuns = new Map<
    string,
    { runId: string; channelId: string; threadId?: string; agentId: string }
  >();

  const agentsDir = path.join(openBotDir, 'agents');
  const pluginsDir = path.join(openBotDir, 'plugins');

  await fs.mkdir(agentsDir, { recursive: true });
  await fs.mkdir(pluginsDir, { recursive: true });

  initPlugins(pluginsDir);

  // Pre-warm caches for agents and plugins to speed up first UI load
  storageService.getAgents().catch((err) => console.warn('[server] Failed to pre-warm agents cache', err));
  storageService.getPlugins().catch((err) => console.warn('[server] Failed to pre-warm plugins cache', err));

  const getContext = (req: express.Request) => {
    const channelId =
      req.get('x-openbot-channel-id') || req.query.channelId || (req.body && req.body.channelId);
    const threadId =
      req.get('x-openbot-thread-id') || req.query.threadId || (req.body && req.body.threadId);
    const agentId =
      req.get('x-openbot-agent-id') || req.query.agentId || (req.body && req.body.agentId);
    const runId =
      req.get('x-openbot-run-id') ||
      req.query.runId ||
      (req.body && req.body.runId) ||
      `run_${generateId()}`;
    const responseType =
      req.get('x-openbot-response-type') ||
      req.query.responseType ||
      (req.body && req.body.responseType);

    return {
      channelId: (channelId || (threadId ? 'uncategorized' : 'uncategorized')) as string, // Default to uncategorized if none
      threadId: threadId as string | undefined,
      agentId: agentId as string | undefined,
      runId: runId as string,
      responseType: responseType as string | undefined,
    };
  };

  const getClientKey = (channelId: string, threadId?: string) =>
    threadId ? `${channelId}:${threadId}` : channelId;
  const getRunKey = (runId: string, agentId: string, channelId: string, threadId?: string) =>
    `${runId}:${agentId}:${channelId}:${threadId || ''}`;

  const sendToClientKey = (clientKey: string, chunk: OpenBotEvent) => {
    const threadClients = clients.get(clientKey);
    if (!threadClients || threadClients.length === 0) return;

    // Auto-detect "read" state: if someone is listening, they just "read" this event.
    if (chunk.id && clientKey !== GLOBAL_CHANNEL_ID) {
      const parts = clientKey.split(':');
      const channelId = parts[0];
      const threadId = parts[1]; // undefined if no ":"
      storageService.setLastRead({ channelId, threadId, lastReadEventId: chunk.id }).catch(() => {});
    }

    threadClients.forEach((client) => {
      if (!client.writableEnded) {
        client.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    });
  };

  const buildActiveRunsSnapshot = (): ActiveRunsSnapshotEvent => {
    const byBucket = new Map<string, Bucket>();
    for (const run of activeRuns.values()) {
      const threadId = run.threadId || undefined;
      const key = JSON.stringify([run.channelId, threadId ?? null]);
      let bucket = byBucket.get(key);
      if (!bucket) {
        bucket = { channelId: run.channelId, threadId, activeCount: 0, agentIds: new Set<string>() };
        byBucket.set(key, bucket);
      }
      bucket.activeCount += 1;
      bucket.agentIds.add(run.agentId);
    }
    const channels = Array.from(byBucket.values())
      .sort((a, b) => {
        const c = a.channelId.localeCompare(b.channelId);
        if (c !== 0) return c;
        return (a.threadId ?? '').localeCompare(b.threadId ?? '');
      })
      .map(({ channelId, threadId, activeCount, agentIds }) => {
        const row: ActiveRunsSnapshotEvent['data']['channels'][number] = {
          channelId,
          activeCount,
          agentIds: Array.from(agentIds),
        };
        if (threadId !== undefined) {
          row.threadId = threadId;
        }
        return row;
      });
    return {
      type: 'agent:active-runs:snapshot',
      data: { channels },
    };
  };

  // Drop every tracked run for a channel/thread. A stop aborts the whole
  // chain (parent + delegated sub-agents), but the sub-agents' `agent:run:end`
  // events can be swallowed when the parent run loop breaks on abort, leaving
  // orphaned entries that keep a channel falsely "active". Purging by
  // channel/thread guarantees the snapshot self-heals after a stop.
  const purgeActiveRunsForThread = (channelId: string, threadId?: string): void => {
    const target = threadId || undefined;
    for (const [key, run] of activeRuns) {
      if (run.channelId === channelId && (run.threadId || undefined) === target) {
        activeRuns.delete(key);
      }
    }
  };

  app.use(cors());

  const resolvePublicBaseUrl = () => getPublicBaseUrl(PORT, config.publicUrl);

  app.use((req, res, next) => {
    const isWorkspaceUpload =
      req.method === 'POST' &&
      req.path === '/api/publish' &&
      req.get('x-openbot-event-type') === 'action:storage:upload-file';

    if (isWorkspaceUpload) {
      express.raw({ type: () => true, limit: '100mb' })(req, res, next);
      return;
    }

    express.json({ limit: '20mb' })(req, res, next);
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: pkg.version });
  });

  app.get('/api/events', (req, res) => {
    const { channelId, threadId } = getContext(req);
    const clientKey = getClientKey(channelId, threadId);

    // SSE response headers: keep the HTTP connection open and unbuffered.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Helpful behind proxies (for example nginx) to avoid response buffering.
    res.setHeader('X-Accel-Buffering', 'no');
    // Flush headers immediately so the browser moves from "connecting" to "open".
    res.flushHeaders();

    // Tell EventSource clients how long to wait before reconnecting.
    res.write('retry: 3000\n');
    // Initial comment frame so the stream has activity right after subscribe.
    res.write(': connected\n\n');

    // Track all active SSE subscribers for fan-out in /api/publish.
    if (!clients.has(clientKey)) {
      clients.set(clientKey, []);
    }
    clients.get(clientKey)!.push(res);

    // Auto-detect "read" state on connection: mark the latest event as seen.
    if (channelId !== GLOBAL_CHANNEL_ID) {
      storageService
        .getEvents({ channelId, threadId })
        .then((events) => {
          const latestId = events[events.length - 1]?.id;
          if (latestId) {
            return storageService.setLastRead({ channelId, threadId, lastReadEventId: latestId });
          }
        })
        .catch(() => {});
    }

    if (channelId === GLOBAL_CHANNEL_ID) {
      const snapshot = buildActiveRunsSnapshot();

      ensureEventId(snapshot);
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    }

    // Keep connection alive through intermediaries that close idle streams.
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': keepalive\n\n');
      }
    }, 25000);

    req.on('close', () => {
      // Cleanup heartbeat + subscriber when the client disconnects.
      clearInterval(heartbeat);
      const threadClients = clients.get(clientKey);
      if (threadClients) {
        const index = threadClients.indexOf(res);
        if (index !== -1) {
          threadClients.splice(index, 1);
        }
        if (threadClients.length === 0) {
          clients.delete(clientKey);
        }
      }
    });
  });

  app.post('/api/publish', async (req, res) => {
    if (req.get('x-openbot-event-type') === 'action:storage:upload-file') {
      const channelId =
        req.get('x-openbot-channel-id') ||
        (typeof req.query.channelId === 'string' ? req.query.channelId : undefined);
      const filePath = req.get('x-openbot-file-path');
      const overwrite = req.get('x-openbot-file-overwrite') === 'true';

      if (!channelId?.trim()) {
        res.status(400).json({ error: 'channelId is required' });
        return;
      }
      if (!filePath?.trim()) {
        res.status(400).json({ error: 'x-openbot-file-path header is required' });
        return;
      }

      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (body.length === 0) {
        res.status(400).json({ error: 'Request body is empty' });
        return;
      }

      try {
        const result = await storageService.uploadChannelFile({
          channelId: channelId.trim(),
          path: filePath.trim(),
          body,
          overwrite,
        });
        const url = buildWorkspaceFileUrl({
          baseUrl: resolvePublicBaseUrl(),
          channelId: channelId.trim(),
          filePath: result.path,
        });
        res.json({
          type: 'action:storage:upload-file:result',
          data: { success: true, ...result, url },
        });
      } catch (error) {
        res.status(400).json({
          type: 'action:storage:upload-file:result',
          data: {
            success: false,
            path: filePath,
            error: error instanceof Error ? error.message : 'Upload failed',
          },
        });
      }
      return;
    }

    const parseResult = publishEventSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid publish event payload',
        details: parseResult.error.issues.map((issue) => issue.message),
      });
      return;
    }

    const event = parseResult.data as OpenBotEvent;

    const { channelId, threadId, agentId, runId } = getContext(req);

    if (!channelId || !channelId.trim()) {
      res.status(400).json({ error: 'channelId is required' });
      return;
    }

    if (event.type === 'action:storage:write-file') {
      const data = (event.data ?? {}) as {
        path?: string;
        content?: string;
        encoding?: 'utf8' | 'base64';
        overwrite?: boolean;
      };

      if (!data.path?.trim()) {
        res.status(400).json({
          type: 'action:storage:write-file:result',
          data: { success: false, path: '', error: 'path is required' },
        });
        return;
      }
      if (typeof data.content !== 'string') {
        res.status(400).json({
          type: 'action:storage:write-file:result',
          data: { success: false, path: data.path, error: 'content is required' },
        });
        return;
      }

      try {
        const result = await storageService.writeChannelFile({
          channelId,
          path: data.path.trim(),
          content: data.content,
          encoding: data.encoding ?? 'utf8',
          overwrite: data.overwrite ?? false,
        });
        const url = buildWorkspaceFileUrl({
          baseUrl: resolvePublicBaseUrl(),
          channelId,
          filePath: result.path,
        });
        res.json({
          type: 'action:storage:write-file:result',
          data: { success: true, ...result, url },
        });
      } catch (error) {
        res.status(400).json({
          type: 'action:storage:write-file:result',
          data: {
            success: false,
            path: data.path,
            error: error instanceof Error ? error.message : 'Write failed',
          },
        });
      }
      return;
    }

    // Stop request: cancel the in-flight run (and any delegated sub-agents in the
    // same thread) instead of spinning up a new agent turn.
    if (event.type === 'action:agent_run_stop') {
      const data = (event.data ?? {}) as {
        runId?: string;
        agentId?: string;
        channelId?: string;
        threadId?: string;
        reason?: string;
      };
      const targetChannelId = data.channelId || channelId;
      const targetThreadId = data.threadId || threadId;
      const stopped = abortRegistry.abort(abortKey(targetChannelId, targetThreadId));
      purgeActiveRunsForThread(targetChannelId, targetThreadId);

      const stoppedEvent: OpenBotEvent = {
        type: 'agent:run:stopped',
        data: {
          runId: data.runId || runId,
          agentId: data.agentId || agentId || ORCHESTRATOR_AGENT_ID,
          channelId: targetChannelId,
          threadId: targetThreadId,
          reason: data.reason,
        },
      } as OpenBotEvent;
      ensureEventId(stoppedEvent);
      sendToClientKey(getClientKey(targetChannelId, targetThreadId), stoppedEvent);
      sendToClientKey(GLOBAL_CHANNEL_ID, stoppedEvent);

      res.json({ success: stopped });
      return;
    }

    const onEvent = async (chunk: OpenBotEvent, state?: OpenBotState) => {
      const targetChannelId = state?.channelId || channelId;
      const targetThreadId = state?.threadId || threadId;
      const targetClientKey = getClientKey(targetChannelId, targetThreadId);

      if (chunk.type === 'agent:run:start') {
        activeRuns.set(
          getRunKey(chunk.data.runId, chunk.data.agentId, chunk.data.channelId, chunk.data.threadId),
          {
            runId: chunk.data.runId,
            channelId: chunk.data.channelId,
            threadId: chunk.data.threadId,
            agentId: chunk.data.agentId,
          },
        );
      } else if (chunk.type === 'agent:run:end') {
        activeRuns.delete(
          getRunKey(chunk.data.runId, chunk.data.agentId, chunk.data.channelId, chunk.data.threadId),
        );
      } else if (chunk.type === 'agent:run:stopped') {
        purgeActiveRunsForThread(chunk.data.channelId, chunk.data.threadId);
      }

      sendToClientKey(targetClientKey, chunk);

      if (
        chunk.type === 'agent:run:start' ||
        chunk.type === 'agent:run:end' ||
        chunk.type === 'agent:run:stopped'
      ) {
        sendToClientKey(GLOBAL_CHANNEL_ID, chunk);
      }
    };

    try {
      ensureEventId(event);

      await runAgent({
        runId,
        agentId: agentId || ORCHESTRATOR_AGENT_ID,
        event,
        channelId,
        threadId,
        publicBaseUrl: resolvePublicBaseUrl(),
        onEvent,
      });
      res.sendStatus(200);
    } catch (error) {
      console.error('[publish] Failed to dispatch event', {
        runId,
        channelId,
        threadId,
        eventType: event.type,
        error,
      });
      res.status(500).json({ error: 'Failed to process publish event' });
    }
  });

  app.get('/api/state', async (req, res) => {
    let event: OpenBotEvent;
    try {
      event = openBotEventFromQuery(req.query);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Invalid query';
      res.status(400).json({ error: message });
      return;
    }

    const { channelId, threadId, agentId, runId } = getContext(req);

    if (event.type === 'action:storage:serve-file') {
      const filePath = (event.data as { path?: string })?.path;
      if (!channelId?.trim()) {
        res.status(400).json({ error: 'channelId is required' });
        return;
      }
      if (!filePath?.trim()) {
        res.status(400).json({ error: 'path is required' });
        return;
      }

      try {
        const { abs, size, mimeType } = await storageService.getChannelFileStat({
          channelId,
          path: filePath.trim(),
        });
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', String(size));
        res.setHeader('Cache-Control', 'private, max-age=3600');
        openChannelFileStream(abs).pipe(res);
      } catch (error) {
        res.status(404).json({
          error: error instanceof Error ? error.message : 'File not found',
        });
      }
      return;
    }

    const events: OpenBotEvent[] = [];

    const onEvent = async (chunk: OpenBotEvent) => {
      events.push(chunk);
    };

    try {
      ensureEventId(event);

      await runAgent({
        runId,
        agentId: agentId || STATE_AGENT_ID,
        event,
        channelId,
        threadId,
        persistEvents: false,
        publicBaseUrl: resolvePublicBaseUrl(),
        onEvent,
      });
      res.json({ events });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process state request' });
    }
  });

  app.listen(PORT, () => {
    console.log(`\x1b[32mOpenBot server listening at http://localhost:${PORT}\x1b[0m`);
    console.log(
      `🌐 Visit \x1b[96m\x1b[1mhttps://openbot.one\x1b[0m to connect to this runtime and manage everything from there. ✨`,
    );
  });
}
