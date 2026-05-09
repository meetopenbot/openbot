import { MelonyPlugin } from 'melony';
import z from 'zod';
import { OpenBotEvent, OpenBotState } from '../../../app/types.js';

/**
 * Tool definitions for the OpenBot orchestrator's delegation/handoff capability.
 *
 * The actual cross-agent routing lives in the bus's queue processor: when this
 * plugin yields `handoff:request` / `delegation:request` events, the orchestrator
 * intercepts them and dispatches an `agent:invoke` to the target agent.
 */
export const delegationToolDefinitions = {
  handoff: {
    description:
      'Transfer control to another agent. The target agent continues the task and you do not wait for a tool result.',
    inputSchema: z.object({
      agentId: z.string().describe('The ID of the target agent.'),
      content: z.string().describe('The message or task to hand off.'),
    }),
  },
  delegate: {
    description:
      'Delegate a subtask to another agent and wait for its result so you can continue.',
    inputSchema: z.object({
      agentId: z.string().describe('The ID of the target agent.'),
      content: z.string().describe('The subtask you want the target agent to execute.'),
    }),
  },
};

export const delegationPlugin = (): MelonyPlugin<OpenBotState, OpenBotEvent> => (builder) => {
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

  builder.on('action:delegate', async function* (event, context) {
    const { agentId, content } = event.data;
    const widgetId = event.meta?.toolCallId
      ? `delegate_${event.meta.toolCallId}`
      : `delegate_${Date.now()}`;

    yield {
      type: 'client:ui:widget',
      data: {
        kind: 'message',
        widgetId,
        title: `Delegation started: ${agentId}`,
        body: `Running delegated task in background.\n\n${content}`,
        state: 'open',
        metadata: {
          type: 'delegation:status',
          phase: 'started',
          delegatedAgentId: agentId,
        },
      },
      meta: { ...(event.meta || {}), agentId: context.state.agentId },
    };

    yield {
      type: 'delegation:request',
      data: { agentId, content },
      meta: {
        ...(event.meta || {}),
        parentAgentId: context.state.agentId,
        delegationWidgetId: widgetId,
        agentId: context.state.agentId,
      },
    };
  });
};
