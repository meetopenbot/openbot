import { AgentDetails } from '../plugins/storage.js';
import { delegationToolDefinitions } from '../plugins/delegation.js';
import { storageToolDefinitions } from '../plugins/storage.js';
import { mcpToolDefinitions } from '../plugins/mcp.js';
import { uiToolDefinitions } from '../plugins/ui.js';
import { shellToolDefinitions } from '../plugins/shell.js';
import { storageService } from '../services/storage.js';
import { readFileSync } from 'node:fs';

const SYSTEM_ICON_DATA_URL = (() => {
  try {
    const svg = readFileSync(new URL('../assets/icon.svg', import.meta.url), 'utf-8').trim();
    if (!svg.startsWith('<svg')) return undefined;
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
  } catch {
    return undefined;
  }
})();

export const getSystemAgentDetails = (overrides?: Partial<AgentDetails>): AgentDetails => {
  const defaults: AgentDetails = {
    id: 'system',
    name: 'OpenBot',
    image: SYSTEM_ICON_DATA_URL,
    instructions:
      'You are OpenBot, the primary AI assistant and orchestrator of this workspace. Your goal is to help users onboard, answer questions about the system, and suggest specialized agents for specific tasks.\n\n' +
      '### How to use OpenBot:\n' +
      '1. **General Chat**: Just type your message here, and I will help you.\n' +
      '2. **Specialized Agents**: You can delegate tasks to specialized agents for specific tasks. For example, use the `delegate` tool to invoke the `os` agent for terminal commands and file operations.\n' +
      '3. **Channels**: Channels are shared spaces where multiple agents can participate. You can create new channels for different topics.\n' +
      '4. **Local-First**: OpenBot runs entirely on your machine. Your data stays private and local.\n\n' +
      '### Workflow Guidelines:\n' +
      '- **Todo Schema**: Keep todo items simple. Each item should have a short `id`, a clear `task` description, and a `status` (e.g., "pending", "in_progress", "done").\n' +
      '- **Delegation**: When delegating to another agent, reference the relevant Task ID from the thread state. Update the task status (e.g., using `patch_thread_details`) as progress is made.\n\n' +
      'If you need to know what agents or plugins are installed, I can help you find that information.',
    runtime: {
      name: 'ai-sdk',
      config: {
        model: 'openai/gpt-5.4-nano',
        toolDefinitions: {
          ...delegationToolDefinitions,
          ...storageToolDefinitions,
          ...mcpToolDefinitions,
          ...shellToolDefinitions,
          // ...uiToolDefinitions, // TODO: Re-enable this when we have a way to render UI widgets in the web dashboard
        },
      },
    },
    plugins: [
      { name: 'storage', config: { storage: storageService } },
      { name: 'delegation', config: {} },
      { name: 'mcp', config: {} },
      { name: 'ui', config: {} },
      {
        name: 'approval',
        config: {
          rules: [
            {
              action: 'action:shell_exec',
              denyEvent: 'action:shell_exec:result',
              message: 'The agent wants to run a terminal command.',
              detailKeys: ['command', 'cwd', 'shell', 'timeoutMs'],
              hiddenKeys: ['env'],
              denyData: {
                exitCode: null,
                stdout: '',
                stderr: 'Command execution was denied by the user.',
                timedOut: false,
              },
            },
          ],
        },
      },
      { name: 'shell', config: {} },
    ],
    description: 'System coordinator agent',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  if (!overrides) return defaults;

  // Merge logic:
  // - Simple fields: override if present
  // - Runtime: merge config/model, but preserve toolDefinitions unless explicitly overridden
  // - Plugins: merge by name (user plugins override defaults)

  const mergedRuntime = {
    ...(typeof defaults.runtime === 'object' ? defaults.runtime : {}),
    ...(typeof overrides.runtime === 'object' ? overrides.runtime : {}),
    name:
      (typeof overrides.runtime === 'object' ? overrides.runtime.name : overrides.runtime) ||
      (typeof defaults.runtime === 'object' ? defaults.runtime.name : defaults.runtime) ||
      'ai-sdk',
    config: {
      ...(defaults.runtime && typeof defaults.runtime !== 'string' ? defaults.runtime.config : {}),
      ...(overrides.runtime && typeof overrides.runtime !== 'string'
        ? overrides.runtime.config
        : {}),
      toolDefinitions: {
        ...(defaults.runtime && typeof defaults.runtime !== 'string'
          ? (defaults.runtime.config as any)?.toolDefinitions
          : {}),
        ...(overrides.runtime && typeof overrides.runtime !== 'string'
          ? (overrides.runtime.config as any)?.toolDefinitions
          : {}),
      },
    },
  };

  const mergedPlugins = [...(defaults.plugins || [])];
  if (overrides.plugins) {
    for (const p of overrides.plugins) {
      const name = typeof p === 'string' ? p : p.name;
      const index = mergedPlugins.findIndex((existing) => {
        const existingName = typeof existing === 'string' ? existing : existing.name;
        return existingName === name;
      });
      if (index !== -1) {
        mergedPlugins[index] = p;
      } else {
        mergedPlugins.push(p);
      }
    }
  }

  return {
    ...defaults,
    ...overrides,
    id: 'system', // Always enforce 'system' ID
    image: overrides.image || defaults.image, // Ensure image is preserved if not explicitly overridden
    runtime: mergedRuntime as any,
    plugins: mergedPlugins,
    updatedAt: new Date(),
  };
};
