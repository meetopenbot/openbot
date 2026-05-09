import type { AgentPackage } from '../../bus/agent-package.js';
import { claudeCodeRuntime } from './runtime.js';
import { CLAUDE_CODE_SYSTEM_PROMPT } from './system-prompt.js';

/**
 * Claude Code — an OpenBot agent package backed by `@anthropic-ai/claude-agent-sdk`.
 *
 * This folder is intentionally self-contained: it only depends on the bus
 * public types (`AgentPackage`, `OpenBotEvent`, `OpenBotState`), `melony`, and
 * the Claude Agent SDK. It can be lifted out of this repo into a standalone
 * npm package (e.g. `openbot-plugin-claude-code`) without code changes; only
 * the import paths to the bus types need to be replaced with a peer-dep
 * import (e.g. `import type { AgentPackage } from 'openbot/bus'`).
 */
export const claudeCodeAgentPackage: AgentPackage = {
  id: 'claude-code',
  name: 'Claude Code',
  description:
    'Anthropic Claude Code agent. Uses the Claude Agent SDK to read code, edit files, and run shell commands inside the channel\'s workspace.',
  defaultInstructions: CLAUDE_CODE_SYSTEM_PROMPT,
  configSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        description: 'Claude model alias or full id (e.g. sonnet, opus, claude-opus-4-5).',
        default: 'sonnet',
      },
      permissionMode: {
        type: 'string',
        description:
          'How the SDK handles tool permission prompts: default | acceptEdits | bypassPermissions | plan | dontAsk | auto.',
        default: 'default',
        enum: ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'],
      },
    },
  },
  factory: ({ agentDetails, config, storage }) => {
    const model = typeof config.model === 'string' && config.model ? config.model : 'sonnet';
    const permissionMode =
      typeof config.permissionMode === 'string' && config.permissionMode
        ? (config.permissionMode as 'default')
        : 'default';

    return claudeCodeRuntime({
      model,
      permissionMode,
      system: agentDetails.instructions || CLAUDE_CODE_SYSTEM_PROMPT,
      storage,
    });
  },
};

export default claudeCodeAgentPackage;
