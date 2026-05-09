import type { Plugin } from '../../bus/plugin.js';
import { claudeCodeRuntime } from './runtime.js';
import { CLAUDE_CODE_SYSTEM_PROMPT } from './system-prompt.js';

/**
 * `claude-code` — runtime plugin backed by `@anthropic-ai/claude-agent-sdk`.
 *
 * This plugin owns its own tool loop (Read / Edit / Bash / ...) inside the
 * Claude Agent SDK, so it does not consume tools contributed by other plugins.
 */
export const claudeCodePlugin: Plugin = {
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

export default claudeCodePlugin;
