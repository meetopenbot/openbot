import { AgentDetails } from '../plugins/storage.js';
import { threadToolDefinitions } from '../plugins/threads.js';
import { delegationToolDefinitions } from '../plugins/delegation.js';
import { storageService } from '../services/storage.js';

export const getSystemAgentDetails = (): AgentDetails => ({
  id: 'system',
  name: 'OpenBot',
  instructions:
    'You are OpenBot, the primary AI assistant and orchestrator of this workspace. Your goal is to help users onboard, answer questions about the system, and suggest specialized agents for specific tasks.\n\n' +
    '### How to use OpenBot:\n' +
    '1. **General Chat**: Just type your message here, and I will help you.\n' +
    '2. **Specialized Agents**: You can @mention specialized agents for specific tasks. For example, use `@os` for terminal commands and file operations.\n' +
    '3. **Channels**: Channels are shared spaces where multiple agents can participate. You can create new channels for different topics.\n' +
    '4. **Local-First**: OpenBot runs entirely on your machine. Your data stays private and local.\n\n' +
    'If you need to know what agents or plugins are installed, I can help you find that information.',
  plugins: [
    {
      name: 'ai-sdk',
      config: {
        model: 'openai/gpt-4o-mini',
        toolDefinitions: { ...threadToolDefinitions, ...delegationToolDefinitions },
      },
    },
    { name: 'storage', config: { storage: storageService } },
    { name: 'threads', config: {} },
    { name: 'delegation', config: {} },
  ],
  description: 'System orchestrator agent',
  createdAt: new Date(),
  updatedAt: new Date(),
});
