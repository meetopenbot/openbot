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
        const depth: number = (context.state as any)._delegationDepth ?? 0;

        if (depth >= MAX_DEPTH) {
          yield {
            type: 'action:result',
            data: { action: 'delegate', toolCallId, result: 'Max delegation depth reached.' },
          } as ConversationEvent;
          return;
        }

        const runtime = deps.getAgentRuntimes().get(agentId);
        if (!runtime) {
          yield {
            type: 'action:result',
            data: { action: 'delegate', toolCallId, result: `Agent "${agentId}" not found.` },
          } as ConversationEvent;
          return;
        }

        // Emit the delegation event. The server run-loop intercepts this to:
        //   1. Queue an independent sub-run for the target agent
        //   2. Resume the lead agent with the result when the sub-run finishes
        // The lead agent's turn ends here — no blocking wait.
        yield {
          type: 'agent:delegation',
          id: generateId(),
          data: {
            targetAgentId: agentId,
            content,
            toolCallId,
            leadAgentId: currentAgentId,
            depth: depth + 1,
          },
          meta: { agentId: currentAgentId },
        } as ConversationEvent;
      },
    );
  };
}
