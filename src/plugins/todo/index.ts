import z from 'zod';
import type { Plugin } from '../../bus/plugin.js';

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
              .describe('Suggested agent id for this step (plain id, no @ prefix).'),
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
  delegate_to_agent: {
    description:
      'Run a worker agent on a self-contained task and return their output. ' +
      'Call when a todo step should be executed by a participant; review the result and update todos before delegating again or replying to the user.',
    inputSchema: z.object({
      agentId: z
        .string()
        .min(1)
        .describe('Worker agent id from channel participants (plain id, no @ prefix).'),
      task: z
        .string()
        .min(1)
        .describe('Complete instruction for the worker — they do not see the full todo plan.'),
      todoId: z.string().optional().describe('Optional todo id this step relates to.'),
    }),
  },
};

export const todoPlugin: Plugin = {
  id: 'todo',
  name: 'Todo',
  description: 'Shared todo list and worker delegation for multi-step orchestration.',
  toolDefinitions: todoToolDefinitions,
  factory: () => () => {
    // Handlers live in bus/services.ts.
  },
};

export default todoPlugin;
