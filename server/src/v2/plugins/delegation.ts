import { MelonyPlugin } from 'melony';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import z from 'zod';

/**
 * Delegation Plugin for Melony.
 * Automatically handles delegation events and routes them through the storage service.
 */
export const delegationPlugin = (): MelonyPlugin<OpenBotState, OpenBotEvent> => (builder) => {
  builder.on('action:delegate', async function* (event, context) {
    const { agentId, content } = event.data;

    // 1. Show the delegation in the UI
    yield {
      type: 'agent:output',
      data: {
        content: `Delegating to **${agentId}**: ${content}`,
      },
      meta: {
        ...(event.meta || {}),
        agentId: context.state.agentId,
      },
    };

    // 2. Trigger the linear execution loop in orchestratorService
    yield {
      type: 'agent:invoke',
      data: {
        agentId,
        content,
      },
      meta: {
        ...(event.meta || {}),
        agentId: context.state.agentId,
      },
    };
  });
};

export const delegationToolDefinitions = {
  delegate: {
    description:
      'Delegate a task to another agent. The agent will run independently and feed results back to you. Call at most once per step.',
    inputSchema: z.object({
      agentId: z.string().describe('The ID of the agent (e.g. "os", "browser", "tavily").'),
      content: z.string().describe('The message or task for the agent.'),
    }),
  },
};

export const plugin = {
  name: 'delegation',
  description: 'Delegation plugin',
  version: '1.0.0',
  author: 'OpenBot',
  license: 'MIT',
  website: 'https://openbot.one',
  factory: delegationPlugin,
  toolDefinitions: delegationToolDefinitions,
};
