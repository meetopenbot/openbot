import z from 'zod';
import type { Plugin } from '../../bus/plugin.js';

/**
 * `todo` — shared, per-thread task list for autonomous multi-agent flows.
 *
 * Todos live in `threadDetails.state.todos` and are owned by the system
 * (handlers in `bus/services.ts`). Any agent in the thread can read the
 * list via context, and propose mutations through these tools. Each item
 * may carry an `assignee` agent id to drive an
 * autonomous, multi-step plan across agents.
 *
 * Keep the surface minimal: two tools (replace-all, patch-one) cover plan
 * authoring, status transitions, and reassignment.
 */
const todoStatus = z.enum(['pending', 'in_progress', 'done', 'cancelled']);

const todoToolDefinitions = {
  todo_write: {
    description: 'Manage the shared todo list (create, update, append, remove).',
    inputSchema: z.object({
      todos: z
        .array(
          z.object({
            id: z
              .string()
              .optional()
              .describe('Stable id. Reuse existing ids to update; omit to create.'),
            content: z.string().min(1).optional().describe('What needs to be done.'),
            status: todoStatus.optional().describe('Defaults to `pending`.'),
            assignee: z
              .string()
              .optional()
              .describe('Agent id responsible for this step.'),
            deleted: z.boolean().optional().describe('If true, remove this item.'),
          }),
        )
        .describe('List of todo items to write or patch.'),
      merge: z
        .boolean()
        .optional()
        .describe(
          'If true (default), patches existing items by id and appends new ones. If false, replaces the entire list.',
        ),
    }),
  },
};

export const todoPlugin: Plugin = {
  id: 'todo',
  name: 'Todo',
  description:
    'Shared todo list for coordinating multi-step, multi-agent work.',
  toolDefinitions: todoToolDefinitions,
  factory: () => () => {
    // Handlers live in bus/services.ts; this plugin only contributes tool definitions.
  },
};

export default todoPlugin;
