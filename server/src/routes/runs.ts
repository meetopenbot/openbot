import { Router } from 'express';
import { exec } from 'node:child_process';
import os from 'node:os';
import { generateId } from 'melony';
import { normalizeConversationId } from '../services/conversation.js';
import type { ConversationEvent } from '../app/types.js';
import type { ServerContext } from './context.js';

export function createRunsRouter(ctx: ServerContext) {
  const router = Router();

  // POST /api/runs
  router.post('/runs', async (req, res) => {
    const event = req.body as Partial<ConversationEvent>;
    if (!event || typeof event.type !== 'string') {
      return res.status(400).json({
        error: 'The request body must be an event with a string `type`.',
      });
    }

    const conversationHeader = req.get('x-openbot-conversation-id');
    const conversationIdRaw =
      typeof conversationHeader === 'string' ? conversationHeader.trim() : '';
    const conversationId = normalizeConversationId(conversationIdRaw);
    if (!conversationId) {
      return res.status(400).json({ error: 'x-openbot-conversation-id is required' });
    }

    const runIdHeader = req.get('x-openbot-run-id');
    const runId =
      typeof runIdHeader === 'string' && runIdHeader.trim()
        ? runIdHeader.trim()
        : `run_${generateId()}`;

    const normalizedEvent = event as ConversationEvent;
    await ctx.appendConversationEvent(conversationId, runId, normalizedEvent);
    ctx.runQueue.push({ conversationId, runId, event: normalizedEvent });
    void ctx.processRunQueue();
    res.status(202).json({ runId });
  });

  // POST /api/runs/:runId/cancel
  router.post('/runs/:runId/cancel', async (req, res) => {
    const runId = req.params.runId?.trim();
    if (!runId) return res.status(400).json({ error: 'runId is required' });
    if (!ctx.activeRuns.has(runId) && !ctx.runQueue.some((job) => job.runId === runId)) {
      return res.status(404).json({ error: 'Run not found' });
    }
    ctx.cancelledRuns.add(runId);
    return res.json({ success: true });
  });

  // POST /api/actions/reload
  router.post('/actions/reload', async (_req, res) => {
    ctx.scheduleReload();
    res.json({ success: true, message: 'Reload scheduled' });
  });

  // POST /api/actions/open-folder
  router.post('/actions/open-folder', async (req, res) => {
    const { folder } = req.body;

    if (folder) {
      const command =
        os.platform() === 'win32'
          ? `explorer "${folder}"`
          : os.platform() === 'darwin'
            ? `open "${folder}"`
            : `xdg-open "${folder}"`;

      exec(command, (error) => {
        if (error) console.error(`Failed to open folder: ${error.message}`);
      });
    }

    res.json({ success: true });
  });

  return router;
}
