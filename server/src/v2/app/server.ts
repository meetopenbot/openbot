import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { DEFAULT_BASE_DIR, loadConfig, loadVariables, resolvePath } from '../app/config.js';
import { OpenBotEvent, OpenBotState } from './types.js';
import path from 'path';
import fs from 'fs/promises';
import { processService } from '../services/process.js';
import { createOpenBot } from './open-bot.js';
import { storageService } from '../services/storage.js';

export interface ServerOptions {
  port?: number;
}

export async function startServer(options: ServerOptions = {}) {
  const config = loadConfig();
  const variables = loadVariables();

  processService.applyVariablesToProcessEnv(variables.variables);

  const baseDir = config.baseDir || DEFAULT_BASE_DIR;
  const openBotDir = resolvePath(baseDir);
  const PORT = Number(options.port ?? config.port ?? process.env.PORT ?? 4132);
  const app = express();
  const clients: Map<string, express.Response[]> = new Map();

  const runtime = createOpenBot({ agentId: 'default' });

  const agentsDir = path.join(openBotDir, 'agents');
  const pluginsDir = path.join(openBotDir, 'plugins');
  await fs.mkdir(agentsDir, { recursive: true });
  await fs.mkdir(pluginsDir, { recursive: true });

  app.use(cors());
  app.use(express.json({ limit: '20mb' }));

  app.get('/api/events', (req, res) => {
    const threadId = (req.get('x-openbot-thread-id') || req.query.threadId || 'default') as string;

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
    if (!clients.has(threadId)) {
      clients.set(threadId, []);
    }
    clients.get(threadId)!.push(res);

    // Keep connection alive through intermediaries that close idle streams.
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': keepalive\n\n');
      }
    }, 25000);

    req.on('close', () => {
      // Cleanup heartbeat + subscriber when the client disconnects.
      clearInterval(heartbeat);
      const threadClients = clients.get(threadId);
      if (threadClients) {
        const index = threadClients.indexOf(res);
        if (index !== -1) {
          threadClients.splice(index, 1);
        }
        if (threadClients.length === 0) {
          clients.delete(threadId);
        }
      }
    });
  });

  app.post('/api/publish', async (req, res) => {
    const event = req.body as OpenBotEvent;
    const threadId = (req.get('x-openbot-thread-id') || req.body.threadId || 'default') as string;
    const runId = req.get('x-openbot-run-id') || `run_${Date.now()}`;
    const agentId = req.get('x-openbot-agent-id') || 'default';

    const state: OpenBotState = {
      threadId,
      runId,
      agentId,
    };

    res.sendStatus(200);

    // Broadcast each runtime chunk as an SSE "data:" frame to all subscribers of this thread.
    for await (const chunk of runtime.run(event, { state })) {
      await storageService.storeEvent({ threadId, event: chunk });

      const threadClients = clients.get(threadId);
      if (threadClients) {
        threadClients.forEach((client) => {
          client.write(`data: ${JSON.stringify(chunk)}\n\n`);
        });
      }
    }
  });

  app.get('/api/state', async (req, res) => {
    const event = req.query as OpenBotEvent;
    const threadId = req.get('x-openbot-thread-id') || 'default';
    const runId = req.get('x-openbot-run-id') || `run_${Date.now()}`;
    const agentId = req.get('x-openbot-agent-id') || 'default';

    const events: OpenBotEvent[] = [];

    const state: OpenBotState = {
      threadId,
      runId,
      agentId,
    };

    const runtime = createOpenBot({ agentId: state.agentId });

    for await (const chunk of runtime.run(event, { state })) {
      events.push(chunk);
    }

    res.json({ events });
  });

  app.listen(PORT, () => {
    console.log(`\x1b[32mOpenBot server listening at http://localhost:${PORT}\x1b[0m`);
    console.log(`  - Events endpoint: GET /events (SSE)`);
    console.log(`  - Publish endpoint: POST /publish`);
    console.log(`  - State endpoint: GET /state`);
  });
}
