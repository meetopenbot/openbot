import type { Plugin } from '../../bus/plugin.js';
import { aiSdkRuntime } from './runtime.js';
import { AI_SDK_SYSTEM_PROMPT } from './system-prompt.js';

/**
 * `ai-sdk` — generic LLM runtime plugin built on the Vercel AI SDK.
 *
 * Owns `agent:invoke` and consumes the merged `tools` map provided by the
 * agent loader (collected from every tool plugin attached to the same agent).
 * Pair with tool plugins like `shell`, `mcp`, `delegation`, etc.
 */
export const aiSdkPlugin: Plugin = {
  id: 'ai-sdk',
  name: 'AI SDK Runtime',
  description:
    'Generic LLM runtime built on the Vercel AI SDK. Consumes tools contributed by other plugins.',
  defaultInstructions: AI_SDK_SYSTEM_PROMPT,
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
  factory: ({ agentDetails, config, storage, tools }) => {
    const model =
      typeof config.model === 'string' && config.model
        ? config.model
        : 'openai/gpt-4o-mini';

    return aiSdkRuntime({
      model,
      system: agentDetails.instructions || AI_SDK_SYSTEM_PROMPT,
      storage,
      toolDefinitions: tools,
    });
  },
};

export default aiSdkPlugin;
