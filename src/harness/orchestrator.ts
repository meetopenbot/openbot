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

type StopRequest = {
  runId: string;
  agentId?: string;
  channelId?: string;
  threadId?: string;
  reason?: string;
  requestedAt: number;
};

const stopRequests: StopRequest[] = [];
const STOP_REQUEST_TTL_MS = 30 * 60 * 1000;

const pruneStopRequests = () => {
  const now = Date.now();
  for (let i = stopRequests.length - 1; i >= 0; i -= 1) {
    if (now - stopRequests[i].requestedAt > STOP_REQUEST_TTL_MS) {
      stopRequests.splice(i, 1);
    }
  }
};

const findStopRequest = (options: {
  runId: string;
  agentId: string;
  channelId: string;
  threadId?: string;
}): StopRequest | undefined => {
  pruneStopRequests();
  return stopRequests.find((request) => {
    if (request.runId !== options.runId) return false;
    if (request.agentId && request.agentId !== options.agentId) return false;
    if (request.channelId && request.channelId !== options.channelId) return false;
    if (request.threadId && request.threadId !== options.threadId) return false;
    return true;
  });
};

export const orchestratorService = {
  /**
   * The primary entry point for all events coming into the system (e.g. from the API).
   * Handles routing and initial UI message creation.
   */
  dispatch: async (options: DispatchOptions): Promise<void> => {
    const { runId, channelId, threadId, onEvent } = options;
    if (options.event.type === 'action:agent_run_stop') {
      const stopEvent = options.event;
      stopRequests.push({
        runId: stopEvent.data.runId,
        agentId: stopEvent.data.agentId,
        channelId: stopEvent.data.channelId || channelId,
        threadId: stopEvent.data.threadId || threadId,
        reason: stopEvent.data.reason,
        requestedAt: Date.now(),
      });
      const state = await storageService.getOpenBotState({
        runId,
        agentId: options.agentId || 'system',
        channelId,
        threadId,
        event: options.event,
      });
      await onEvent(
        {
          type: 'action:agent_run_stop:result',
          data: {
            success: true,
            message: `Stop requested for run ${stopEvent.data.runId}.`,
          },
          meta: options.event.meta,
        },
        state,
      );
      return;
    }

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
      shouldStopRun: orchestratorService.shouldStopRun,
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
    const stopInfo = {
      runId,
      agentId,
      channelId,
      threadId,
    };

    try {
      // RUN the agent runtime
      for await (const chunk of agentRuntime.run(event, { state: agentState, runId })) {
        const stopRequest = findStopRequest(stopInfo);
        if (stopRequest) {
          await onEvent(
            {
              type: 'agent:run:stopped',
              data: {
                runId,
                agentId,
                channelId,
                threadId,
                reason: stopRequest.reason,
              },
            },
            agentState,
          );
          break;
        }
        chunk.meta = { ...chunk.meta, agentId };
        await onEvent(chunk, agentState);
      }
    } catch (error) {
      console.error(`[orchestrator] Agent run failed: ${agentId}`, error);
    }
  },
  shouldStopRun: (options: {
    runId: string;
    agentId: string;
    channelId: string;
    threadId?: string;
  }): { shouldStop: boolean; reason?: string } => {
    const request = findStopRequest(options);
    return request ? { shouldStop: true, reason: request.reason } : { shouldStop: false };
  },
};
