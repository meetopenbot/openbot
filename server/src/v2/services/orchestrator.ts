import { createOpenBotRuntime } from '../app/open-bot.js';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import { storageService } from './storage.js';

export interface ExecuteAgentOptions {
  agentId: string;
  event: OpenBotEvent;
  state: OpenBotState;
  threadId: string;
  onEvent: (chunk: OpenBotEvent) => Promise<void>;
}

export const orchestratorService = {
  /**
   * Executes an agent runtime and handles recursive delegation.
   */
  executeAgent: async (options: ExecuteAgentOptions): Promise<void> => {
    const { agentId, event, state, threadId, onEvent } = options;

    // agent details
    let agentDetails;
    if (agentId === 'system') {
      agentDetails = {
        instructions: '',
        plugins: ['storage'],
      };
    } else {
      agentDetails = await storageService.getAgentDetails({ agentId });
    }

    // agent runtime
    const agentRuntime = await createOpenBotRuntime({
      agentId,
      instructions: agentDetails.instructions,
      plugins: agentDetails.plugins,
    });

    let hasProducedOutput = false;

    // RUN
    for await (const chunk of agentRuntime.run(event, { state })) {
      // EVENT
      await onEvent(chunk);

      // has produced output
      if (chunk.type === 'agent:output') {
        hasProducedOutput = true;
      }

      // Recursive delegation handling
      if (chunk.type === 'agent:delegate') {
        const { agentId: targetAgentId, content: targetContent } = chunk.data;
        await orchestratorService.executeAgent({
          agentId: targetAgentId,
          event: {
            type: 'agent:input',
            data: { content: targetContent },
          },
          state: { ...state, agentId: targetAgentId },
          threadId,
          onEvent,
        });
      }
    }

    // If the event was an agent:input but no output or delegation was yielded,
    // the agent is likely misconfigured (e.g., missing an LLM plugin).
    if (event.type === 'agent:input' && !hasProducedOutput) {
      await onEvent({
        type: 'agent:output',
        data: {
          content: `⚠️ **${agentId}** is not configured to handle inputs. Please check its plugin configuration (e.g., missing \`ai-sdk\`).`,
        },
      });

      await onEvent({
        type: 'client:ui:message',
        data: {
          content: `⚠️ **${agentId}** is not configured to handle inputs. Please check its plugin configuration (e.g., missing \`ai-sdk\`).`,
          role: 'assistant',
        },
        meta: {
          agentId,
        },
      });
    }
  },
};
