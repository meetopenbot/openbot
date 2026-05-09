import { readFileSync } from 'node:fs';
import { MelonyPlugin } from 'melony';
import { OpenBotEvent, OpenBotState } from '../../app/types.js';
import { AgentPackage } from '../../bus/agent-package.js';
import { openBotRuntime } from './runtime.js';
import { shellPlugin, shellToolDefinitions } from './tools/shell.js';
import { mcpPlugin, mcpToolDefinitions } from './tools/mcp.js';
import { uiPlugin, uiToolDefinitions } from './tools/ui.js';
import { delegationPlugin, delegationToolDefinitions } from './tools/delegation.js';
import { storageToolDefinitions } from './tools/storage.js';
import { approvalPlugin } from './middleware/approval.js';
import { DEFAULT_OPENBOT_APPROVAL_RULES, OPENBOT_SYSTEM_PROMPT } from './system-prompt.js';

const OPENBOT_ICON_DATA_URL = (() => {
  try {
    const svg = readFileSync(new URL('../../assets/icon.svg', import.meta.url), 'utf-8').trim();
    if (!svg.startsWith('<svg')) return undefined;
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
  } catch {
    return undefined;
  }
})();

const composeMelonyPlugin = (
  ...plugins: MelonyPlugin<OpenBotState, OpenBotEvent>[]
): MelonyPlugin<OpenBotState, OpenBotEvent> => {
  return (builder) => {
    for (const plugin of plugins) {
      plugin(builder);
    }
  };
};

/**
 * OpenBot — the first-party orchestrator agent package.
 *
 * Treats the bus as a peer environment: registers a runtime that owns
 * `agent:invoke`, exposes a curated tool set (delegation, storage, MCP, shell,
 * UI widgets), and wires approval middleware for protected actions.
 *
 * Other agents (Codex, Claude Code, Gemini, custom Coder/Researcher) are
 * separate AgentPackages with their own runtime + tool composition.
 */
export const openBotAgentPackage: AgentPackage = {
  id: 'openbot',
  name: 'OpenBot',
  description:
    'First-party orchestration agent for OpenBot. Coordinates other agents via handoff and delegation.',
  image: OPENBOT_ICON_DATA_URL,
  defaultInstructions: OPENBOT_SYSTEM_PROMPT,
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
  factory: ({ agentDetails, config, storage }) => {
    const model =
      typeof config.model === 'string' && config.model
        ? config.model
        : 'openai/gpt-4o-mini';

    const toolDefinitions = {
      ...delegationToolDefinitions,
      ...storageToolDefinitions,
      ...mcpToolDefinitions,
      ...shellToolDefinitions,
      // Re-enable when the dashboard renders widgets:
      // ...uiToolDefinitions,
    };

    const systemPrompt = agentDetails.instructions || OPENBOT_SYSTEM_PROMPT;

    return composeMelonyPlugin(
      openBotRuntime({
        model,
        system: systemPrompt,
        storage,
        toolDefinitions,
      }),
      approvalPlugin({ rules: DEFAULT_OPENBOT_APPROVAL_RULES }),
      delegationPlugin(),
      shellPlugin(),
      mcpPlugin(),
      uiPlugin(),
    );
  },
};

// Suppress unused warning while UI widget tools are not wired into the LLM tool list.
void uiToolDefinitions;
