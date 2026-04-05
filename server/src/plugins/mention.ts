import { z } from 'zod';
import { generateId, MelonyBuilder } from 'melony';
import { ConversationEvent, ConversationState } from '../app/types.js';

/**
 * Tool definitions for mentioning agents.
 */
export const mentionToolDefinitions = {
  mention: {
    description:
      'Mention one other agent to ask them a question or give them a task. Call this at most once per assistant step: wait for the tool result before calling mention again for a different agent. Parallel mentions in the same step are not supported and can block the run.',
    inputSchema: z.object({
      agentId: z.string().describe('The ID of the agent to mention (e.g. "os", "browser").'),
      content: z.string().describe('The message or task for the mentioned agent.'),
    }),
  },
};

/**
 * Mention Plugin — provides a tool for agents to mention each other.
 */
export function mentionPlugin() {
  return (builder: MelonyBuilder<ConversationState, ConversationEvent>) => {
    builder.on(
      'action:mention',
      async function* (
        event: ConversationEvent,
        context: { runId: string; state: ConversationState; agentId?: string },
      ) {
        const { agentId, content, toolCallId } = event.data;
        const delegatorId =
          context.state.openBotExecutingAgentId ??
          (event.meta as { agentName?: string } | undefined)?.agentName ??
          "default";
        const nextDepth = (event.meta?.depth as number) || 0;

        yield {
          type: 'agent:delegation',
          id: generateId(),
          data: {
            targetAgentId: agentId,
            content: `@${agentId} ${content}`,
          },
          meta: {
            agentName: delegatorId,
          },
        } as ConversationEvent;

        // Yield a special trigger event that the server loop can catch.
        // We use the agent:input type so the router can handle it correctly.
        yield {
          type: 'agent:trigger',
          data: {
            toolCallId,
            event: {
              type: 'agent:input',
              data: { content: `@${agentId} ${content}` },
              meta: {
                delegatedBy: delegatorId,
                agentName: delegatorId,
                depth: nextDepth + 1,
              },
            },
          },
        } as any;

        const feedback = context.state.openBotDelegationToolFeedback;
        let resultText = `Successfully mentioned @${agentId}.`;
        if (
          feedback &&
          feedback.toolCallId === toolCallId &&
          typeof feedback.result === 'string' &&
          feedback.result.length > 0
        ) {
          resultText = feedback.result;
        }
        delete context.state.openBotDelegationToolFeedback;

        yield {
          type: 'action:result',
          data: {
            action: 'mention',
            result: resultText,
            toolCallId,
          },
        } as ConversationEvent;
      },
    );
  };
}
