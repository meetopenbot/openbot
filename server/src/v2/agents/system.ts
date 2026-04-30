import { AgentDetails } from '../plugins/storage.js';
import { delegationToolDefinitions } from '../plugins/delegation.js';
import { storageToolDefinitions } from '../plugins/storage.js';
import { mcpToolDefinitions } from '../plugins/mcp.js';
import { uiToolDefinitions } from '../plugins/ui.js';
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

export const getSystemAgentDetails = (): AgentDetails => ({
  id: 'system',
  name: 'Lolly',
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
    '- **Interactive Widgets**: Use `render_ui_widget` to give the user a visual progress bar (`kind: "todo_list"`), request permissions (`kind: "approval"`), or gather structured data (`kind: "form"`).\n' +
    '- **Delegation**: When delegating to another agent, reference the relevant Task ID from the thread state. Update the task status (e.g., using `patch_thread_details`) as progress is made.\n\n' +
    'If you need to know what agents or plugins are installed, I can help you find that information.',
  runtime: {
    name: 'ai-sdk',
    config: {
      model: 'openai/gpt-4o-mini',
      toolDefinitions: {
        ...delegationToolDefinitions,
        ...storageToolDefinitions,
        ...mcpToolDefinitions,
        ...uiToolDefinitions,
      },
    },
  },
  plugins: [
    { name: 'storage', config: { storage: storageService } },
    { name: 'delegation', config: {} },
    { name: 'mcp', config: {} },
    { name: 'ui', config: {} },
  ],
  description: 'System coordinator agent',
  createdAt: new Date(),
  updatedAt: new Date(),
});
