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
import { getBaseDir, loadConfig } from '../app/config.js';
import { ActiveRunsSnapshotEvent, OpenBotEvent, OpenBotState } from './types.js';
import { runAgent, STATE_AGENT_ID, ORCHESTRATOR_AGENT_ID } from '../harness/index.js';
import { initPlugins } from '../services/plugins/registry.js';
import { storageService } from '../plugins/storage/service.js';
import { getPublicBaseUrl } from '../plugins/storage/files.js';
import { ensureEventId, openBotEventFromQuery } from './utils.js';
import { abortRegistry, abortKey } from '../services/abort.js';
import { resolvePublishTargetAgentId, resolveRespondingAgentId } from './responding-agent.js';
import {
  DEFAULT_UNCATEGORIZED_SPEC,
  UNCATEGORIZED_CHANNEL_ID,
} from './channel-ids.js';

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

  const openBotDir = getBaseDir();
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

  const getRawChannelId = (req: express.Request): string | undefined => {
    const raw =
      req.get('x-openbot-channel-id') ||
      req.query.channelId ||
      (req.body && req.body.channelId);
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    return trimmed || undefined;
  };

  const getContext = (req: express.Request) => {
    const rawChannelId = getRawChannelId(req);
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
      channelId: (rawChannelId || UNCATEGORIZED_CHANNEL_ID) as string,
      rawChannelId,
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

  const broadcastActiveRunsSnapshot = (): void => {
    const snapshot = buildActiveRunsSnapshot();
    ensureEventId(snapshot);
    sendToClientKey(GLOBAL_CHANNEL_ID, snapshot);
  };

  const persistLifecycleEvent = (
    event: OpenBotEvent,
    targetChannelId: string,
    targetThreadId?: string,
  ): void => {
    ensureEventId(event);
    storageService
      .storeEvent({
        channelId: targetChannelId,
        threadId: targetThreadId,
        event,
      })
      .catch((error) => {
        console.error('[server] Failed to persist lifecycle event', {
          type: event.type,
          channelId: targetChannelId,
          threadId: targetThreadId,
          error,
        });
      });
  };

  // Drop every tracked run for a channel/thread. A stop aborts the whole
  // chain (parent + delegated sub-agents), but the sub-agents' `agent:run:end`
  // events can be swallowed when the parent run loop breaks on abort, leaving
  // orphaned entries that keep a channel falsely "active". Emit explicit
  // `agent:run:end` for each purged run and refresh the global snapshot so
  // clients stay in sync even when the parent harness stops yielding.
  const purgeActiveRunsForThread = (channelId: string, threadId?: string): void => {
    const target = threadId || undefined;
    const removed: Array<{
      runId: string;
      channelId: string;
      threadId?: string;
      agentId: string;
    }> = [];

    for (const [key, run] of activeRuns) {
      if (run.channelId === channelId && (run.threadId || undefined) === target) {
        removed.push(run);
        activeRuns.delete(key);
      }
    }

    for (const run of removed) {
      const endEvent: OpenBotEvent = {
        type: 'agent:run:end',
        data: {
          runId: run.runId,
          agentId: run.agentId,
          channelId: run.channelId,
          threadId: run.threadId,
        },
      } as OpenBotEvent;
      ensureEventId(endEvent);
      persistLifecycleEvent(endEvent, run.channelId, run.threadId);
      sendToClientKey(getClientKey(run.channelId, run.threadId), endEvent);
      sendToClientKey(GLOBAL_CHANNEL_ID, endEvent);
    }
  };

  // Support for Chrome's Private Network Access (PNA)
  // https://developer.chrome.com/blog/private-network-access-preflight/
  app.use((req, res, next) => {
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    // If it's a preflight request, we should also ensure the Vary header is set
    if (req.method === 'OPTIONS') {
      res.setHeader('Vary', 'Access-Control-Request-Private-Network');
    }
    next();
  });

  app.use(cors());

  const gatewayToken = process.env.OPENBOT_GATEWAY_TOKEN?.trim();
  if (gatewayToken) {
    app.use((req, res, next) => {
      if (req.path === '/api/health' || req.method === 'OPTIONS') {
        next();
        return;
      }

      const got = req.get('x-openbot-gateway-token');
      if (got !== gatewayToken) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      next();
    });
  }

  const resolvePublicBaseUrl = () => getPublicBaseUrl(PORT, config.publicUrl);

  app.use(express.json({ limit: '20mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: pkg.version, apiVersion: 1 });
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

    // Stop request: cancel the in-flight run
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
      let resolvedStopAgentId = data.agentId || agentId || ORCHESTRATOR_AGENT_ID;
      try {
        const resolved = await resolveRespondingAgentId({
          channelId: targetChannelId,
          threadId: targetThreadId,
          requestedAgentId: data.agentId || agentId,
        });
        resolvedStopAgentId = resolved.agentId;
      } catch (error) {
        console.warn('[publish] Failed to resolve responding agent for stop request', {
          channelId: targetChannelId,
          threadId: targetThreadId,
          error,
        });
      }
      const stopped = abortRegistry.abort(abortKey(targetChannelId, targetThreadId));
      purgeActiveRunsForThread(targetChannelId, targetThreadId);
      // Resync global clients even when nothing was tracked server-side.
      broadcastActiveRunsSnapshot();

      const stoppedEvent: OpenBotEvent = {
        type: 'agent:run:stopped',
        data: {
          runId: data.runId || runId,
          agentId: resolvedStopAgentId,
          channelId: targetChannelId,
          threadId: targetThreadId,
          reason: data.reason,
        },
      } as OpenBotEvent;
      ensureEventId(stoppedEvent);
      persistLifecycleEvent(stoppedEvent, targetChannelId, targetThreadId);
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
        broadcastActiveRunsSnapshot();
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

      const isUserConversationStart =
        event.type === 'agent:invoke' &&
        event.data?.role === 'user' &&
        typeof event.data.content === 'string' &&
        event.data.content.trim().length > 0;

      if (isUserConversationStart && channelId === UNCATEGORIZED_CHANNEL_ID) {
        await storageService.ensureChannel({
          channelId: UNCATEGORIZED_CHANNEL_ID,
          spec: DEFAULT_UNCATEGORIZED_SPEC,
          initialState: { name: 'Uncategorized' },
        });
      }

      const bindIfUnbound = event.type === 'agent:invoke';
      const target = await resolvePublishTargetAgentId({
        eventType: event.type,
        channelId,
        threadId,
        requestedAgentId: agentId,
        eventMeta: event.meta,
        bindIfUnbound,
      });

      if ('error' in target) {
        res.status(400).json({ error: 'agentId is required for widget response' });
        return;
      }

      await runAgent({
        runId,
        agentId: target.agentId,
        event,
        channelId,
        threadId,
        publicBaseUrl: resolvePublicBaseUrl(),
        onEvent,
      });
      res.sendStatus(200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isUnknownAgent =
        (error instanceof Error &&
          ((error as Error & { code?: string }).code === 'AGENT_NOT_FOUND' ||
            error.message.includes('does not exist'))) ||
        message.includes('does not exist');

      console.error('[publish] Failed to dispatch event', {
        runId,
        channelId,
        threadId,
        eventType: event.type,
        error,
      });

      if (isUnknownAgent) {
        res.status(400).json({ error: message });
        return;
      }

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

    // In-memory active runs (not persisted). Mirrors the initial SSE frame on __global__.
    if (channelId === GLOBAL_CHANNEL_ID && event.type === 'action:storage:get-active-runs') {
      const snapshot = buildActiveRunsSnapshot();
      ensureEventId(snapshot);
      res.json({ events: [snapshot] });
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

  const HOST = process.env.HOST || '0.0.0.0';
  const server = app.listen(PORT, HOST, () => {
    console.log(`\x1b[32mOpenBot server listening at http://${HOST}:${PORT}\x1b[0m`);
    console.log(
      `🌐 Visit \x1b[96m\x1b[1mhttps://openbot.one\x1b[0m to connect to this runtime and manage everything from there. ✨`,
    );
  });

  const shutdown = (signal: string) => {
    console.log(`\n[server] Received ${signal}, shutting down...`);
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[server] Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
