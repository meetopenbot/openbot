import { MelonyPlugin } from 'melony';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import z from 'zod';

/**
 * Delegation Plugin for Melony.
 * Handles handoff/delegation events and routes internal control events to the orchestrator.
 */
export const delegationPlugin = (): MelonyPlugin<OpenBotState, OpenBotEvent> => (builder) => {
  builder.on('action:handoff', async function* (event, context) {
    const { agentId, content } = event.data;

    // 1. Show the handoff in the UI
    yield {
      type: 'agent:output',
      data: {
        content: `Handing off to **${agentId}**: ${content}`,
      },
      meta: {
        ...(event.meta || {}),
        agentId: context.state.agentId,
      },
    };

    // 2. Orchestrator turns this into a real agent:invoke for the target.
    yield {
      type: 'handoff:request',
      data: { agentId, content },
      meta: {
        ...(event.meta || {}),
        agentId: context.state.agentId,
      },
    };

    // 3. Acknowledge tool completion so providers requiring tool-result pairing stay consistent.
    if (event.meta?.toolCallId) {
      yield {
        type: 'action:handoff:result',
        data: {
          success: true,
          agentId,
          accepted: true,
        },
        meta: {
          ...(event.meta || {}),
          agentId: context.state.agentId,
        },
      };
    }
  });

  builder.on('action:delegate', async function* (event, context) {
    const { agentId, content } = event.data;
    const widgetId = event.meta?.toolCallId
      ? `delegate_${event.meta.toolCallId}`
      : `delegate_${Date.now()}`;

    // 1. Show delegation progress in UI (child output stays hidden for delegate mode).
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
      meta: {
        ...(event.meta || {}),
        agentId: context.state.agentId,
      },
    };

    // 2. Orchestrator executes target agent and feeds result back as action:delegate:result.
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

export const delegationToolDefinitions = {
  handoff: {
    description:
      'Transfer control to another agent. The target agent continues the task and you do not wait for a tool result.',
    inputSchema: z.object({
      agentId: z.string().describe('The ID of the target agent (e.g. "os", "browser", "tavily").'),
      content: z.string().describe('The message or task to hand off.'),
    }),
  },
  delegate: {
    description:
      'Delegate a subtask to another agent and wait for its result so you can continue.',
    inputSchema: z.object({
      agentId: z.string().describe('The ID of the target agent (e.g. "os", "browser", "tavily").'),
      content: z.string().describe('The subtask you want the target agent to execute.'),
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
