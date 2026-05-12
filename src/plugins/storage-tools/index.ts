import z from 'zod';
import type { Plugin } from '../../bus/plugin.js';

/**
 * `storage-tools` — exposes channel/thread/variable mutation tools to runtime
 * plugins. The actual handlers live in `bus/services.ts` because storage is
 * platform infrastructure, not agent behaviour.
 */
const storageToolDefinitions = {
  create_channel: {
    description:
      'Create a new channel. Use when the user intent is clearly different from the current channel and should be split. Always confirm before creating. Skip for simple Q&A.',
    inputSchema: z.object({
      channelId: z
        .string()
        .describe('Unique channel ID (e.g. product-launch, backend-platform, channel_roadmap).'),
      spec: z
        .string()
        .optional()
        .describe('Optional initial markdown content for the channel spec.'),
      initialState: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Optional initial state object for the channel.'),
      cwd: z
        .string()
        .optional()
        .describe('Optional initial current working directory for the channel.'),
    }),
  },
  patch_channel_details: {
    description: 'Patch current channel details (state, spec, cwd).',
    inputSchema: z
      .object({
        state: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'JSON state object for the channel. Use for structured data like `todos` or metadata.',
          ),
        spec: z
          .string()
          .optional()
          .describe(
            'Markdown content for the channel specification (SPEC.md). Use for goals and rules.',
          ),
        cwd: z.string().optional().describe('Current working directory for the channel.'),
      })
      .refine(
        (value) => value.state !== undefined || value.spec !== undefined || value.cwd !== undefined,
        { message: 'Provide at least one of state, spec, or cwd.' },
      ),
  },
  patch_thread_details: {
    description: 'Patch current thread details (state).',
    inputSchema: z.object({
      state: z
        .record(z.string(), z.unknown())
        .describe(
          'JSON state object for the thread. Use for structured data like `todos` or progress.',
        ),
    }),
  },
  create_variable: {
    description: 'Create or update a variable in the workspace storage.',
    inputSchema: z.object({
      key: z.string().describe('The key of the variable.'),
      value: z.string().describe('The value of the variable.'),
      secret: z.boolean().optional().describe('Whether the variable is a secret.'),
    }),
  },
  delete_variable: {
    description: 'Delete a variable from the workspace storage.',
    inputSchema: z.object({
      key: z.string().describe('The key of the variable to delete.'),
    }),
  },
};

export const storageToolsPlugin: Plugin = {
  id: 'storage-tools',
  name: 'Storage Tools',
  description: 'Tools for creating channels, patching state, and managing workspace variables.',
  toolDefinitions: storageToolDefinitions,
  factory: () => () => {
    // Handlers live in bus/services.ts; this plugin only contributes tool definitions.
  },
};

export default storageToolsPlugin;
