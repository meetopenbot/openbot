import { createOpenBot } from '../app/open-bot.js';
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

    let agentDetails;
    if (agentId === 'system') {
      agentDetails = {
        instructions: '',
        plugins: ['storage'],
      };
    } else {
      agentDetails = await storageService.getAgentDetails({ agentId });
    }

    const agentRuntime = await createOpenBot({
      agentId,
      instructions: agentDetails.instructions,
      plugins: agentDetails.plugins,
    });

    for await (const chunk of agentRuntime.run(event, { state })) {
      await onEvent(chunk);

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
  },
};
