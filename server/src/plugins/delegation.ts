import { z } from 'zod';
import { generateId, MelonyBuilder, Runtime } from 'melony';
import { ConversationEvent, ConversationState } from '../app/types.js';

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

const MAX_DEPTH = 3;

export interface DelegationPluginDeps {
  getAgentRuntimes: () => Map<string, Runtime<ConversationState, ConversationEvent>>;
}

export function delegationPlugin(deps: DelegationPluginDeps) {
  return (builder: MelonyBuilder<ConversationState, ConversationEvent>) => {
    builder.on(
      'action:delegate',
      async function* (
        event: ConversationEvent,
        context: { runId: string; state: ConversationState },
      ) {
        const { agentId, content, toolCallId } = event.data;
        const currentAgentId = (context.state as any).agentId ?? 'default';

        const runtime = deps.getAgentRuntimes().get(agentId);
        if (!runtime) {
          yield {
            type: 'action:result',
            data: { action: 'delegate', toolCallId, result: `Agent "${agentId}" not found.` },
          } as ConversationEvent;
          return;
        }

        // Just output the delegation as a message in the channel.
        // The server-side mention detection will pick this up and trigger the target agent.
        yield {
          type: 'agent:output',
          data: { content: `@${agentId} ${content}` },
          meta: { agentId: currentAgentId },
        } as ConversationEvent;

        // yield {
        //   type: 'action:result',
        //   data: {
        //     action: 'delegate',
        //     toolCallId,
        //     result: `Message sent to @${agentId}. Waiting for their response in the channel.`,
        //   },
        //   meta: { agentId: currentAgentId },
        // } as ConversationEvent;
      },
    );
  };
}
