import type { Plugin } from '../../services/plugins/types.js';
import { openbotRuntime } from './runtime.js';

/**
 * `openbot` — the standard, opinionated OpenBot agent runtime.
 *
 * This is the canonical execution loop for OpenBot agents. It handles
 * `agent:invoke`, manages short-term memory, assembles context, and
 * orchestrates tool calls.
 */
export const openbotPlugin: Plugin = {
  id: 'openbot',
  name: 'OpenBot Agent',
  description:
    'The standard, opinionated OpenBot agent runtime. Handles the core execution loop and tool orchestration.',
  configSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        description:
          'Provider model string, e.g. openai/gpt-4o-mini, anthropic/claude-3-5-sonnet-20240620',
        default: 'openai/gpt-4o-mini',
      },
    },
  },
  factory: ({ config, storage, tools }) => {

    return openbotRuntime({
      model: config?.model as string,
      storage,
      toolDefinitions: tools,
    });
  },
};

export default openbotPlugin;
