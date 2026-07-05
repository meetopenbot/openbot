import type { Plugin } from '../../services/plugins/types.js';
import { isCloudSystemAgent, resolveCloudSystemModel } from '../../app/cloud-mode.js';
import { openbotRuntime } from './runtime.js';
import { bashPlugin } from '../bash/index.js';
import { memoryPlugin } from '../memory/index.js';
import { approvalPlugin } from '../approval/index.js';
import { storagePlugin } from '../storage/index.js';
import { delegationPlugin } from '../delegation/index.js';
import { uiPlugin } from '../ui/index.js';
import { previewPlugin } from '../preview/index.js';

/**
 * `openbot` — the standard, opinionated OpenBot agent runtime.
 *
 * This is the canonical execution loop for OpenBot agents. It handles
 * `agent:invoke`, manages short-term memory, assembles context, and
 * orchestrates tool calls.
 * 
 * It comes with a "batteries-included" set of inbuilt tools: bash, memory,
 * storage, delegation, and approval.
 */
export const openbotPlugin: Plugin = {
  id: 'openbot',
  name: 'OpenBot Agent',
  description:
    'The standard OpenBot agent runtime with inbuilt tools (bash, memory, storage, delegation, and approval).',
  configSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        description: 'Model from the hosted marketplace registry.',
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
    ...bashPlugin.toolDefinitions,
    ...memoryPlugin.toolDefinitions,
    ...storagePlugin.toolDefinitions,
    ...delegationPlugin.toolDefinitions,
    ...previewPlugin.toolDefinitions,
    // this is the capability to render UI widgets to the user. We dont need it for now.
    // ...uiPlugin.toolDefinitions,
  },
  factory: (context) => (builder) => {
    const { agentId, config, storage, tools, abortSignal } = context;

    // Register inbuilt plugins
    bashPlugin.factory(context)(builder);
    memoryPlugin.factory(context)(builder);
    storagePlugin.factory(context)(builder);
    delegationPlugin.factory(context)(builder);
    uiPlugin.factory(context)(builder);
    previewPlugin.factory(context)(builder);

    // Approval plugin configuration
    const approvalConfig = (config?.approval as any) || {
      actions: [
        'action:bash',
        'action:bash_start',
        'action:expose_port',
        'action:create_channel',
        'action:delete_channel',
      ],
    };
    approvalPlugin.factory({ ...context, config: approvalConfig })(builder);

    const model = isCloudSystemAgent(agentId)
      ? resolveCloudSystemModel(config?.model as string | undefined)
      : (config?.model as string);

    return openbotRuntime({
      model,
      agentId,
      storage,
      toolDefinitions: tools,
      abortSignal,
    })(builder);
  },
};

export default openbotPlugin;
