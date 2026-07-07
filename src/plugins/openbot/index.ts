import type { Plugin } from '../../services/plugins/types.js';
import { openbotRuntime } from './runtime.js';
import { storagePlugin } from '../storage/index.js';
import { uiPlugin } from '../ui/index.js';

/**
 * `openbot` — minimal agent runtime for the public OpenBot edition.
 *
 * Handles `agent:invoke`, assembles context, and orchestrates storage tools.
 */
export const openbotPlugin: Plugin = {
  id: 'openbot',
  name: 'OpenBot Agent',
  description: 'Minimal OpenBot agent runtime with storage tools.',
  configSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        description: 'Model in provider/model-id format (e.g. openai/gpt-4o-mini).',
      },
    },
  },
  toolDefinitions: {
    ...storagePlugin.toolDefinitions,
  },
  factory: (context) => (builder) => {
    const { agentId, config, storage, tools, abortSignal } = context;

    storagePlugin.factory(context)(builder);
    uiPlugin.factory(context)(builder);

    const model = config?.model as string | undefined;

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
