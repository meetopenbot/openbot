import type { AgentPackage } from '../../bus/agent-package.js';
import { geminiCliRuntime } from './runtime.js';
import { GEMINI_CLI_SYSTEM_PROMPT } from './system-prompt.js';

/**
 * Gemini CLI — an OpenBot agent package backed by Google's `gemini` CLI in
 * headless (`--output-format stream-json`) mode.
 *
 * Like the `claude-code` package, this folder is intentionally self-contained:
 * it depends only on the bus public types (`AgentPackage`, `OpenBotEvent`,
 * `OpenBotState`) and `melony`, plus the `gemini` binary on PATH. It can be
 * lifted into a standalone npm package (e.g. `openbot-plugin-gemini-cli`)
 * without code changes.
 */
export const geminiCliAgentPackage: AgentPackage = {
  id: 'gemini-cli',
  name: 'Gemini CLI',
  description:
    'Google Gemini CLI agent. Spawns the `gemini` binary in headless stream-json mode to read code, edit files, and run shell commands inside the channel\'s workspace.',
  defaultInstructions: GEMINI_CLI_SYSTEM_PROMPT,
  configSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        description: 'Gemini model id (e.g. gemini-2.5-pro, gemini-2.5-flash).',
      },
      yolo: {
        type: 'boolean',
        description: 'Auto-approve all tool calls (passes --yolo). Use cautiously.',
        default: false,
      },
      binary: {
        type: 'string',
        description:
          'Optional path/name of the `gemini` binary. If omitted, the runtime auto-detects `gemini` on PATH and falls back to `npx -y @google/gemini-cli@<npmTag>`.',
      },
      npmTag: {
        type: 'string',
        description: 'npm tag/version of `@google/gemini-cli` to use with the npx fallback.',
        default: 'latest',
      },
    },
  },
  factory: ({ agentDetails, config, storage }) => {
    const model = typeof config.model === 'string' && config.model ? config.model : undefined;
    const binary = typeof config.binary === 'string' && config.binary ? config.binary : undefined;
    const npmTag = typeof config.npmTag === 'string' && config.npmTag ? config.npmTag : 'latest';
    const yolo = typeof config.yolo === 'boolean' ? config.yolo : false;

    return geminiCliRuntime({
      model,
      binary,
      npmTag,
      yolo,
      system: agentDetails.instructions || GEMINI_CLI_SYSTEM_PROMPT,
      storage,
    });
  },
};

export default geminiCliAgentPackage;
