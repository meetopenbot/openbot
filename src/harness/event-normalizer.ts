import { AgentInvokeEvent, OpenBotEvent, OpenBotState } from '../app/types.js';
import { ensureEventId } from '../app/utils.js';
import { storageService } from '../services/storage.js';

export interface NormalizedEventResult {
  finalEvent: OpenBotEvent;
  finalAgentId: string;
}

export const EventNormalizer = {
  /**
   * Normalizes incoming events, converting raw inputs like user:input to agent:invoke.
   * Also handles initial state storage and event bus propagation for user inputs.
   */
  normalize: async (
    event: OpenBotEvent,
    options: {
      runId: string;
      agentId?: string;
      channelId: string;
      threadId?: string;
      onEvent: (chunk: OpenBotEvent, state: OpenBotState) => Promise<boolean | void>;
    }
  ): Promise<NormalizedEventResult> => {
    const { runId, agentId, channelId, threadId, onEvent } = options;

    // 0. Ensure the incoming event has a unique ID immediately
    ensureEventId(event);

    let finalAgentId = agentId || 'system';
    let finalEvent = event;

    // 1. Convert user:input (or other raw inputs) to agent:invoke
    const rawContent = (event as any).data?.content || '';
    if (event.type === 'user:input' || event.type === 'agent:invoke') {
      const normalizedInvokeEvent: AgentInvokeEvent = {
        type: 'agent:invoke',
        id: event.id,
        data: {
          content: rawContent,
          role: 'user',
        },
        meta: {
          agentId: 'system',
          userId: event.meta?.userId,
          userName: event.meta?.userName,
          userAvatarUrl: event.meta?.userAvatarUrl,
        },
      };
      finalEvent = normalizedInvokeEvent;

      // 1. Store the user's input in the current context (main channel or existing thread)
      const initialState = await storageService.getOpenBotState({
        runId,
        agentId: 'system',
        channelId,
        threadId: threadId,
        event: finalEvent,
      });

      // 2. Propagate the user's input to the event bus
      await onEvent(finalEvent, initialState);

      // 3. Prepare the event for the target agent
      finalEvent = {
        ...event,
        type: 'agent:invoke',
        data: {
          ...((event as any).data || {}),
          content: rawContent,
        },
        meta: {
          ...(event.meta || {}),
          // The threadId in meta is the anchor for new threads (Slack-style)
          threadId: threadId || finalEvent.id,
        },
      };
    }

    return { finalEvent, finalAgentId };
  },
};
