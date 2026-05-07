import { OpenBotEvent, OpenBotState } from '../app/types.js';
import { storageService } from '../services/storage.js';
import { createAgentRuntime } from './runtime-factory.js';
import { EventNormalizer } from './event-normalizer.js';
import { QueueProcessor } from './queue-processor.js';

export interface ExecuteAgentOptions {
  runId: string;
  agentId: string;
  event: OpenBotEvent;
  channelId: string;
  threadId?: string;
  onEvent: (chunk: OpenBotEvent, state: OpenBotState) => Promise<boolean | void>;
}

export interface DispatchOptions {
  runId: string;
  agentId?: string;
  event: OpenBotEvent;
  channelId: string;
  threadId?: string;
  onEvent: (chunk: OpenBotEvent, state: OpenBotState) => Promise<boolean | void>;
}

export const orchestratorService = {
  /**
   * The primary entry point for all events coming into the system (e.g. from the API).
   * Handles routing and initial UI message creation.
   */
  dispatch: async (options: DispatchOptions): Promise<void> => {
    const { runId, channelId, threadId, onEvent } = options;

    // 1. Normalize incoming event
    const { finalEvent, finalAgentId } = await EventNormalizer.normalize(options.event, {
      runId,
      agentId: options.agentId,
      channelId,
      threadId,
      onEvent,
    });

    // 2. Initialize Queue Processor
    const processor = new QueueProcessor({
      runId,
      channelId,
      threadId,
      onEvent,
      executeAgent: orchestratorService.executeAgent,
    });

    // 3. Enqueue initial event
    processor.enqueue({ agentId: finalAgentId, event: finalEvent });

    // 4. Run execution loop
    await processor.run();
  },

  /**
   * Executes a single agent runtime.
   */
  executeAgent: async (options: ExecuteAgentOptions): Promise<void> => {
    const { runId, agentId, event, channelId, threadId, onEvent } = options;

    let agentState: OpenBotState;
    try {
      agentState = await storageService.getOpenBotState(options);
    } catch (error) {
      if ((error as Error & { code?: string }).code === 'AGENT_NOT_FOUND') {
        const fallbackState = await storageService.getOpenBotState({
          runId,
          agentId: 'system',
          channelId,
          threadId,
          event,
        });
        const warning = `⚠️ Agent **${agentId}** does not exist. Please check the agent ID and try again.`;

        await onEvent(
          {
            type: 'agent:output',
            data: { content: warning },
            meta: { agentId: 'system', threadId },
          },
          fallbackState,
        );

        return;
      }
      throw error;
    }

    const agentRuntime = await createAgentRuntime(agentState);

    try {
      // RUN the agent runtime
      for await (const chunk of agentRuntime.run(event, { state: agentState, runId })) {
        chunk.meta = { ...chunk.meta, agentId };
        await onEvent(chunk, agentState);
      }
    } catch (error) {
      console.error(`[orchestrator] Agent run failed: ${agentId}`, error);
    }
  },
};
