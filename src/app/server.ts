import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import z from 'zod';
import path from 'path';
import fs from 'fs/promises';
import { generateId } from 'melony';
import { DEFAULT_BASE_DIR, loadConfig, loadVariables, resolvePath } from '../app/config.js';
import { ActiveRunsSnapshotEvent, OpenBotEvent, OpenBotState } from './types.js';
import { processService } from '../services/process.js';
import { storageService } from '../services/storage.js';
import { orchestratorService } from '../services/orchestrator.js';
import { initPlugins } from '../registry/plugins.js';
import { ensureEventId, openBotEventFromQuery } from './utils.js';

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
  const variables = loadVariables();

  processService.applyVariablesToProcessEnv(variables.variables);

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
      channelId: (channelId || (threadId ? 'general' : 'general')) as string, // Default to general if none
      threadId: threadId as string | undefined,
      agentId: agentId as string | undefined,
      runId: runId as string,
      responseType: responseType as string | undefined,
    };
  };

  const getClientKey = (channelId: string, threadId?: string) =>
    threadId ? `${channelId}:${threadId}` : channelId;

  const sendToClientKey = (clientKey: string, chunk: OpenBotEvent) => {
    const threadClients = clients.get(clientKey);
    if (!threadClients) return;
    threadClients.forEach((client) => {
      if (!client.writableEnded) {
        client.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    });
  };

  const buildActiveRunsSnapshot = (): ActiveRunsSnapshotEvent => {
    const byChannel = new Map<string, { activeCount: number; agentIds: Set<string> }>();
    for (const run of activeRuns.values()) {
      const existing = byChannel.get(run.channelId) ?? {
        activeCount: 0,
        agentIds: new Set<string>(),
      };
      existing.activeCount += 1;
      existing.agentIds.add(run.agentId);
      byChannel.set(run.channelId, existing);
    }
    return {
      type: 'agent:active-runs:snapshot',
      data: {
        channels: Array.from(byChannel.entries()).map(([channelId, value]) => ({
          channelId,
          activeCount: value.activeCount,
          agentIds: Array.from(value.agentIds),
        })),
      },
    };
  };

  app.use(cors());
  app.use(express.json({ limit: '20mb' }));

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

    const onEvent = async (chunk: OpenBotEvent, state?: OpenBotState) => {
      ensureEventId(chunk);

      const targetChannelId = state?.channelId || channelId;
      const targetThreadId = state?.threadId || threadId;
      const targetClientKey = getClientKey(targetChannelId, targetThreadId);

      if (chunk.type === 'agent:run:start') {
        activeRuns.set(chunk.data.runId, {
          runId: chunk.data.runId,
          channelId: chunk.data.channelId,
          threadId: chunk.data.threadId,
          agentId: chunk.data.agentId,
        });
      } else if (chunk.type === 'agent:run:end') {
        activeRuns.delete(chunk.data.runId);
      }

      await storageService.storeEvent({
        channelId: targetChannelId,
        threadId: targetThreadId,
        event: chunk,
      });

      sendToClientKey(targetClientKey, chunk);

      if (chunk.type === 'agent:run:start' || chunk.type === 'agent:run:end') {
        sendToClientKey(GLOBAL_CHANNEL_ID, chunk);
      }
    };

    try {
      await orchestratorService.dispatch({
        runId,
        agentId,
        event,
        channelId,
        threadId,
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
    const events: OpenBotEvent[] = [];

    const onEvent = async (chunk: OpenBotEvent) => {
      events.push(chunk);
    };

    await orchestratorService.dispatch({
      runId,
      agentId,
      event,
      channelId,
      threadId,
      onEvent,
    });

    res.json({ events });
  });

  app.listen(PORT, () => {
    console.log(`\x1b[32mOpenBot server listening at http://localhost:${PORT}\x1b[0m`);
    console.log(`  - Events endpoint: GET /events (SSE)`);
    console.log(`  - Publish endpoint: POST /publish`);
    console.log(`  - State endpoint: GET /state`);
  });
}
