import { Router } from 'express';
import { generateId } from 'melony';
import { normalizeConversationId, loadConversationState, saveConversationState } from '../services/conversation.js';
import type { ConversationEvent } from '../app/types.js';
import type { ServerContext } from './context.js';

export function createEventsRouter(ctx: ServerContext) {
  const router = Router();

  router.post('/events', async (req, res) => {
    const event = req.body as ConversationEvent;
    if (!event || typeof event.type !== 'string') {
      return res.status(400).json({ error: 'Request body must be an event with a "type".' });
    }

    const conversationIdHeader = req.get('x-openbot-conversation-id');
    const trimmedConversationHeader =
      typeof conversationIdHeader === 'string' ? conversationIdHeader.trim() : '';
    /** When absent, do not scope to any channel — avoids logging meta API calls to `channels/default`. */
    const hasConversationScope = trimmedConversationHeader.length > 0;
    const conversationId = hasConversationScope
      ? normalizeConversationId(trimmedConversationHeader)
      : '';

    const runIdHeader = req.get('x-openbot-run-id');
    const runId = (typeof runIdHeader === 'string' && runIdHeader.trim() ? runIdHeader.trim() : `run_${generateId()}`) as string;
    
    const responseType = req.get('x-openbot-response-type') || 'stream';

    // Metadata from headers
    const agentId = req.get('x-openbot-agent-id');
    if (agentId) {
      event.meta = { ...event.meta, agentId };
    }

    // Load state only when the request is scoped to a conversation (chat / channel APIs).
    const state = hasConversationScope
      ? ((await loadConversationState(conversationId)) ?? {})
      : {};
    if (hasConversationScope) {
      state.conversationId = conversationId;
    }

    // Special handling for events that need server context
    if (event.type === 'conversations:get-activity') {
      const byConversation: Record<string, { active: boolean; agents: string[] }> = {};
      for (const runId of ctx.activeRuns) {
        const cid = ctx.runConversationById.get(runId);
        if (cid) {
          const entry = byConversation[cid] || { active: true, agents: [] };
          entry.active = true;
          const agents = ctx.runAgentsById.get(runId);
          if (agents) {
            for (const aid of agents) {
              if (!entry.agents.includes(aid)) entry.agents.push(aid);
            }
          }
          byConversation[cid] = entry;
        }
      }
      return res.json({ results: [{ type: 'conversations:activity-result', data: { byConversation } }] });
    }

    if (responseType === 'stream') {
      if (event.type === 'conversations:subscribe' && !hasConversationScope) {
        return res.status(400).json({ error: 'x-openbot-conversation-id is required for subscribe' });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Special handling for subscription: keep the stream open for ALL events in this conversation
      if (event.type === 'conversations:subscribe') {
        const unsubscribe = ctx.subscribeConversation(conversationId, (ev) => {
          res.write(`data: ${JSON.stringify(ev)}\n\n`);
        });

        req.on('close', () => {
          unsubscribe();
          res.end();
        });

        // Yield some initial events if requested?
        const afterId = req.get('x-openbot-after-id');
        if (afterId) {
          const events = await ctx.runtime.run({ type: 'conversations:get-events', data: { conversationId, afterId } } as any, { runId, state });
          for await (const chunk of events) {
             if (chunk.type === 'conversations:events-result') {
                for (const ev of chunk.data) {
                   res.write(`data: ${JSON.stringify(ev)}\n\n`);
                }
             }
          }
        }
        return;
      }

      const iterator = ctx.runtime.run(event, { runId, state });
      try {
        for await (const chunk of iterator) {
          // Skip delta events for log persistence to avoid bloat
          if (hasConversationScope && chunk.type !== 'agent:output-delta') {
            await ctx.appendConversationEvent(conversationId, runId, chunk);
          }
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      } catch (err: any) {
        console.error('Error in event stream:', err);
        const errorEvent = { 
          type: 'run:failed', 
          data: { message: err.message }, 
          meta: { runId } 
        } as ConversationEvent;
        if (hasConversationScope) {
          await ctx.appendConversationEvent(conversationId, runId, errorEvent);
        }
        res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
      } finally {
        if (hasConversationScope) {
          await saveConversationState(conversationId, state);
        }
        res.end();
      }
    } else {
      const results: ConversationEvent[] = [];
      const iterator = ctx.runtime.run(event, { runId, state });
      try {
        for await (const chunk of iterator) {
          if (hasConversationScope && chunk.type !== 'agent:output-delta') {
            await ctx.appendConversationEvent(conversationId, runId, chunk);
          }
          results.push(chunk);
        }
        res.json({ results });
      } catch (err: any) {
        console.error('Error in JSON event:', err);
        res.status(500).json({ error: err.message });
      } finally {
        if (hasConversationScope) {
          await saveConversationState(conversationId, state);
        }
      }
    }
  });

  return router;
}
