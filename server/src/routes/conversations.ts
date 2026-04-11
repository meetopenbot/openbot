import { Router } from 'express';
import { generateId } from 'melony';
import {
  listConversations,
  normalizeConversationId,
  markConversationRead,
  loadConversationState,
  loadConversationEvents,
  loadConversationEventsRaw,
} from '../services/conversation.js';
import type { ConversationEvent } from '../app/types.js';
import type { ServerContext } from './context.js';

export function createConversationsRouter(ctx: ServerContext) {
  const router = Router();

  router.get('/', async (_req, res) => {
    const conversations = await listConversations();
    res.json(conversations);
  });

  router.post('/:id/read', async (req, res) => {
    const conversationId = normalizeConversationId(req.params.id);
    const updated = await markConversationRead(conversationId, 'you');
    if (!updated) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    return res.json({
      success: true,
      conversationId,
      lastReadEventId: updated.readByUser?.you?.lastReadEventId,
      lastReadAt: updated.readByUser?.you?.lastReadAt,
    });
  });

  router.get('/activity', async (_req, res) => {
    const activityByConversation: Record<string, { active: boolean; agents: string[] }> = {};
    for (const runId of ctx.activeRuns) {
      const conversationId = ctx.runConversationById.get(runId);
      if (!conversationId) continue;
      const existing = activityByConversation[conversationId] ?? { active: false, agents: [] };
      existing.active = true;
      const nextAgents = new Set(existing.agents);
      const runAgents = ctx.runAgentsById.get(runId);
      if (runAgents) {
        for (const name of runAgents) nextAgents.add(name);
      }
      existing.agents = Array.from(nextAgents);
      activityByConversation[conversationId] = existing;
    }
    res.json({ byConversation: activityByConversation });
  });

  router.get('/:id/state', async (req, res) => {
    const conversationId = normalizeConversationId(req.params.id);
    const state = await loadConversationState(conversationId);
    if (!state) {
      return res.status(404).json({ error: 'Conversation state not found' });
    }
    res.json(state);
  });

  router.get('/:id/events', async (req, res) => {
    const conversationId = normalizeConversationId(req.params.id);
    const events = await loadConversationEvents(conversationId);
    res.json(events);
  });

  router.get('/:id/events/raw', async (req, res) => {
    const conversationId = normalizeConversationId(req.params.id);
    const events = await loadConversationEventsRaw(conversationId);
    res.send(events);
  });

  router.post('/:id/reactions', async (req, res) => {
    const conversationId = normalizeConversationId(req.params.id);
    const body = req.body as { targetMessageId?: unknown; reaction?: unknown };
    const targetMessageId =
      typeof body.targetMessageId === 'string' ? body.targetMessageId.trim() : '';
    const reaction = body.reaction;
    if (!targetMessageId) {
      return res.status(400).json({ error: 'targetMessageId is required' });
    }
    if (reaction !== 'like' && reaction !== 'dislike' && reaction !== 'none') {
      return res.status(400).json({ error: 'reaction must be like, dislike, or none' });
    }

    const event: ConversationEvent = {
      type: 'message:reaction',
      data: { targetMessageId, reaction },
      id: generateId(),
    };

    try {
      await ctx.appendConversationEvent(conversationId, 'client', event);
      return res.json({ success: true });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to save reaction' });
    }
  });

  router.get('/:id/stream', async (req, res) => {
    const conversationId = normalizeConversationId(req.params.id);
    const afterId = typeof req.query.afterId === 'string' ? req.query.afterId.trim() : '';
    const allEvents = await loadConversationEvents(conversationId);

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.flushHeaders?.();

    let replayEvents = allEvents;
    if (afterId) {
      const afterIndex = allEvents.findIndex((item) => item.id === afterId);
      replayEvents = afterIndex >= 0 ? allEvents.slice(afterIndex + 1) : allEvents;
    }

    for (const item of replayEvents) {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(item)}\n\n`);
    }

    const unsubscribe = ctx.subscribeConversation(conversationId, (chunk) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    });

    const keepAlive = setInterval(() => {
      if (res.writableEnded) return;
      res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
      if (!res.writableEnded) res.end();
    });
  });

  return router;
}
