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
    description:
      'Author or rewrite the shared todo plan for the current thread. Pass the full ordered list — missing items are removed. Use at the start of multi-step work, or whenever the plan changes shape. For status flips, prefer `todo_update`.',
    inputSchema: z.object({
      todos: z
        .array(
          z.object({
            id: z
              .string()
              .optional()
              .describe('Stable id. Reuse existing ids to preserve history; omit to create.'),
            content: z.string().min(1).describe('What needs to be done. One concrete step.'),
            status: todoStatus.optional().describe('Defaults to `pending`.'),
            assignee: z
              .string()
              .optional()
              .describe('Agent id responsible for this step.'),
          }),
        )
        .describe('The complete, ordered plan.'),
    }),
  },
  todo_update: {
    description:
      'Patch a single todo by id. Use to mark progress (`in_progress`, `done`, `cancelled`), rephrase, or reassign without rewriting the whole list.',
    inputSchema: z.object({
      id: z.string().describe('Todo id from `todo_write` or the rendered list.'),
      status: todoStatus.optional(),
      content: z.string().min(1).optional(),
      assignee: z.string().optional().describe('Use empty string to clear.'),
    }),
  },
};

export const todoPlugin: Plugin = {
  id: 'todo',
  name: 'Todo',
  description:
    'Shared per-thread task list for coordinating multi-step, multi-agent work.',
  toolDefinitions: todoToolDefinitions,
  factory: () => () => {
    // Handlers live in bus/services.ts; this plugin only contributes tool definitions.
  },
};

export default todoPlugin;
