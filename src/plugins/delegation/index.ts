import { MelonyPlugin } from 'melony';
import z from 'zod';
import type { Plugin } from '../../bus/plugin.js';
import { OpenBotEvent, OpenBotState } from '../../app/types.js';

const handoffToolDefinitions = {
  handoff: {
    description:
      'Transfer control to another agent. The target agent continues the task in this thread.',
    inputSchema: z.object({
      agentId: z.string().describe('The ID of the target agent.'),
      content: z.string().describe('The message or task to hand off.'),
    }),
  },
};

const handoffPluginRuntime = (): MelonyPlugin<OpenBotState, OpenBotEvent> => (builder) => {
  builder.on('action:handoff', async function* (event, context) {
    const { agentId, content } = event.data;

    yield {
      type: 'agent:output',
      data: { content: `Handing off to **${agentId}**: ${content}` },
      meta: { ...(event.meta || {}), agentId: context.state.agentId },
    };

    yield {
      type: 'handoff:request',
      data: { agentId, content },
      meta: { ...(event.meta || {}), agentId: context.state.agentId },
    };

    if (event.meta?.toolCallId) {
      yield {
        type: 'action:handoff:result',
        data: { success: true, agentId, accepted: true },
        meta: { ...(event.meta || {}), agentId: context.state.agentId },
      };
    }
  });
};

export const delegationPlugin: Plugin = {
  id: 'delegation',
  name: 'Handoff',
  description: 'Hand off tasks to other agents on the bus.',
  toolDefinitions: handoffToolDefinitions,
  factory: () => handoffPluginRuntime(),
};

export default delegationPlugin;
