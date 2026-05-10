import z from 'zod';
import type { Plugin } from '../../bus/plugin.js';

/**
 * `memory` — exposes the global memory store as agent tools.
 *
 * The actual handlers live in `bus/services.ts` because memory is platform
 * infrastructure (shared across every agent on the bus); this plugin only
 * contributes the tool definitions so a runtime plugin (e.g. `ai-sdk`) can
 * surface them to the LLM.
 *
 * Scopes
 * ------
 * - `global`  (default) — visible to every agent and channel.
 * - `agent`   — visible only to the agent that wrote it.
 * - `channel` — visible only inside the active channel.
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
  factory: () => () => {
    // Handlers live in bus/services.ts; this plugin only contributes tool definitions.
  },
};

export default memoryPlugin;
