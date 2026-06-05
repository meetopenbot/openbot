import type { Plugin } from '../../services/plugins/types.js';
import { openbotRuntime } from './runtime.js';
import { shellPlugin } from '../shell/index.js';
import { memoryPlugin } from '../memory/index.js';
import { approvalPlugin } from '../approval/index.js';
import { storagePlugin } from '../storage/index.js';
import { delegationPlugin } from '../delegation/index.js';

/**
 * `openbot` — the standard, opinionated OpenBot agent runtime.
 *
 * This is the canonical execution loop for OpenBot agents. It handles
 * `agent:invoke`, manages short-term memory, assembles context, and
 * orchestrates tool calls.
 * 
 * It comes with a "batteries-included" set of inbuilt tools: shell, memory,
 * storage, delegation, and approval.
 */
export const openbotPlugin: Plugin = {
  id: 'openbot',
  name: 'OpenBot Agent',
  description:
    'The standard OpenBot agent runtime with inbuilt tools (shell, memory, storage, delegation, and approval).',
  configSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        description:
          'Provider model string, e.g. openai/gpt-4o-mini, anthropic/claude-3-5-sonnet-20240620',
        default: 'openai/gpt-4o-mini',
      },
      approval: {
        type: 'object',
        description: 'Configuration for the inbuilt approval plugin.',
        properties: {
          actions: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of actions that require manual approval.',
          },
        },
      },
    },
  },
  toolDefinitions: {
    ...shellPlugin.toolDefinitions,
    ...memoryPlugin.toolDefinitions,
    ...storagePlugin.toolDefinitions,
    ...delegationPlugin.toolDefinitions,
  },
  factory: (context) => (builder) => {
    const { config, storage, tools } = context;

    // Register inbuilt plugins
    shellPlugin.factory(context)(builder);
    memoryPlugin.factory(context)(builder);
    storagePlugin.factory(context)(builder);
    delegationPlugin.factory(context)(builder);

    // Approval plugin configuration
    const approvalConfig = (config?.approval as any) || {
      actions: ['action:shell_exec', 'action:create_channel', 'action:delete_channel'],
    };
    approvalPlugin.factory({ ...context, config: approvalConfig })(builder);

    return openbotRuntime({
      model: config?.model as string,
      storage,
      toolDefinitions: tools,
    })(builder);
  },
};

export default openbotPlugin;
