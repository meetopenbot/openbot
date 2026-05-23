import z from 'zod';
import type { Plugin } from '../../services/plugins/types.js';
import { OpenBotEvent, MemoryScopeAlias } from '../../app/types.js';

/**
 * Resolve a scope alias to a concrete scope string. Aliases let tools accept
 * `agent`/`channel`/`global` without knowing the active ids; the bus rewrites
 * them using `context.state`.
 */
function resolveMemoryScope(
  alias: MemoryScopeAlias | undefined,
  state: any,
): string {
  switch (alias) {
    case 'agent':
      return `agent:${state.agentId}`;
    case 'channel':
      return `channel:${state.channelId}`;
    case 'global':
    case undefined:
      return 'global';
    default:
      return 'global';
  }
}

function resolveMemoryScopeFilter(
  alias: MemoryScopeAlias | 'all' | undefined,
  state: any,
): string[] | undefined {
  if (alias === 'all' || alias === undefined) {
    return ['global', `agent:${state.agentId}`, `channel:${state.channelId}`];
  }
  return [resolveMemoryScope(alias, state)];
}

/**
 * `memory` — exposes the global memory store as agent tools and provides
 * platform-level memory handlers.
 */
const memoryToolDefinitions = {
  remember: {
    description:
      'Persist a durable fact, preference, or note to long-term memory so it can be recalled in future turns and runs. Use for stable information (user preferences, project conventions, contact details, decisions); avoid using it for transient chatter or per-step scratch state — that belongs in thread state. Keep entries short and self-contained.',
    inputSchema: z.object({
      content: z
        .string()
        .min(1)
        .describe(
          'The fact to remember, written so it makes sense out of context (e.g. "User prefers TypeScript over JavaScript.").',
        ),
      scope: z
        .enum(['global', 'agent', 'channel'])
        .optional()
        .describe(
          'Visibility: `global` (default, all agents everywhere), `agent` (only this agent), `channel` (only this channel).',
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe('Optional tags for filtering with `recall`.'),
    }),
  },
  recall: {
    description:
      'Search long-term memory for facts you previously stored with `remember`. Returns up to `limit` matching records with their ids so you can `forget` stale ones.',
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe('Case-insensitive substring filter against memory content.'),
      tag: z.string().optional().describe('Only return memories that include this tag.'),
      scope: z
        .enum(['global', 'agent', 'channel', 'all'])
        .optional()
        .describe(
          'Restrict the search to a single scope. Default `all` returns global + this agent + this channel.',
        ),
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .describe('Maximum records to return (default 20, max 50).'),
    }),
  },
  forget: {
    description:
      'Delete a memory by id. Use after the user asks to forget something or when a previously remembered fact is now wrong. Get ids from `recall`.',
    inputSchema: z.object({
      id: z.string().describe('The memory record id (returned by `recall`/`remember`).'),
    }),
  },
};

export const memoryPlugin: Plugin = {
  id: 'memory',
  name: 'Memory',
  description:
    'Global long-term memory: remember/recall/forget facts across runs and agents.',
  toolDefinitions: memoryToolDefinitions,
  factory: ({ storage }) => (builder) => {
    builder.on('action:remember', async function* (event, context) {
      const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };
      try {
        const { content, scope, tags } = event.data;
        const record = await storage.appendMemory({
          scope: resolveMemoryScope(scope, context.state),
          content,
          tags,
        });
        yield {
          type: 'action:remember:result',
          data: { success: true, record },
          meta: resultMeta,
        } as OpenBotEvent;
      } catch (error) {
        yield {
          type: 'action:remember:result',
          data: {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          meta: resultMeta,
        } as OpenBotEvent;
      }
    });

    builder.on('action:recall', async function* (event, context) {
      const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };
      try {
        const { query, tag, scope, limit } = event.data;
        const records = await storage.listMemories({
          scopes: resolveMemoryScopeFilter(scope, context.state),
          query,
          tag,
          limit,
        });
        yield {
          type: 'action:recall:result',
          data: { success: true, records },
          meta: resultMeta,
        } as OpenBotEvent;
      } catch (error) {
        yield {
          type: 'action:recall:result',
          data: {
            success: false,
            records: [],
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          meta: resultMeta,
        } as OpenBotEvent;
      }
    });

    builder.on('action:forget', async function* (event, context) {
      const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };
      try {
        const deleted = await storage.deleteMemory({ id: event.data.id });
        yield {
          type: 'action:forget:result',
          data: { success: true, deleted },
          meta: resultMeta,
        } as OpenBotEvent;
      } catch (error) {
        yield {
          type: 'action:forget:result',
          data: {
            success: false,
            deleted: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          meta: resultMeta,
        } as OpenBotEvent;
      }
    });
  },
};

export default memoryPlugin;
