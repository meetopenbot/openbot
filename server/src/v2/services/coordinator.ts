import { melony, Runtime } from 'melony';
import { OpenBotEvent, OpenBotState, UIMessageEvent } from '../app/types.js';
import { resolvePlugin } from '../registry/plugins.js';
import { agentPlugin, enhanceInstructions } from '../plugins/agent.js';
import { storageService } from './storage.js';
import { ensureEventId, parseMention } from '../app/utils.js';

export interface ExecuteAgentOptions {
  runId: string;
  agentId: string;
  event: OpenBotEvent;
  channelId: string;
  threadId?: string;
  onEvent: (chunk: OpenBotEvent, state: OpenBotState) => Promise<void>;
}

export interface DispatchOptions {
  runId: string;
  event: OpenBotEvent;
  channelId: string;
  threadId?: string;
  onEvent: (chunk: OpenBotEvent, state: OpenBotState) => Promise<void>;
}

/**
 * Factory for creating an OpenBot Melony Runtime.
 */
async function createRuntime(state: OpenBotState): Promise<Runtime<OpenBotState, OpenBotEvent>> {
  // 1. Prepare instructions
  await enhanceInstructions(state);

  // 2. Initialize runtime with the agent plugin
  const runtime = melony<OpenBotState, OpenBotEvent>({
    initialState: state,
  }).use(agentPlugin());

  // 3. Load additional plugins from agent config
  for (const p of state.agentDetails?.plugins || []) {
    const name = typeof p === 'string' ? p : p?.name;
    if (!name) continue;

    const config = typeof p === 'string' ? {} : { ...p.config };
    const plugin = await resolvePlugin(name, config);

    if (plugin) {
      runtime.use(plugin);
    }
  }

  return runtime.build();
}

export const coordinatorService = {
  /**
   * The primary entry point for all events coming into the system (e.g. from the API).
   * Handles routing, @mentions, and initial UI message creation.
   */
  dispatch: async (options: DispatchOptions): Promise<void> => {
    const { runId, event, channelId, threadId, onEvent } = options;

    let finalAgentId = 'system';
    let finalEvent = event;

    // 1. Convert user:input (or other raw inputs) to agent:invoke and handle @mentions
    const rawContent = (event as any).data?.content || '';
    if (event.type === 'user:input' || event.type === 'agent:invoke') {
      // Create a UI message event for the history representing the user's input
      const uiUserMessage: UIMessageEvent = {
        type: 'client:ui:message',
        data: {
          content: rawContent,
          role: 'user',
        },
        meta: {
          agentId: 'system',
        },
      };
      ensureEventId(uiUserMessage);

      // We use the temporary hydrated state for the onEvent callback
      // even though we haven't fully assembled the runtime yet.
      const initialState = await storageService.getOpenBotState({
        runId,
        agentId: 'system',
        channelId,
        threadId,
        event: finalEvent,
      });
      await onEvent(uiUserMessage, initialState);

      const mention = parseMention(rawContent);
      if (mention) {
        finalAgentId = mention.agentId;
        finalEvent = {
          ...event,
          type: 'agent:invoke',
          data: {
            ...((event as any).data || {}),
            content: mention.stripped,
          },
          meta: {
            ...(event.meta || {}),
            threadId: uiUserMessage.id,
          },
        };
      } else {
        finalEvent = {
          ...event,
          type: 'agent:invoke',
          data: {
            ...((event as any).data || {}),
            content: rawContent,
          },
          meta: {
            ...(event.meta || {}),
            threadId: uiUserMessage.id,
          },
        };
      }
    }

    // 2. Execute the resolved agent
    await coordinatorService.executeAgent({
      runId,
      agentId: finalAgentId,
      event: finalEvent,
      channelId,
      threadId,
      onEvent,
    });
  },

  /**
   * Executes an agent runtime and handles recursive delegation.
   */
  executeAgent: async (options: ExecuteAgentOptions): Promise<void> => {
    const { runId, agentId, event, onEvent } = options;

    const agentState = await storageService.getOpenBotState(options);
    const agentRuntime = await createRuntime(agentState);

    let hasProducedOutput = false;

    // RUN the agent runtime
    for await (const chunk of agentRuntime.run(event, { state: agentState, runId })) {
      // 1. Handle recursive execution (mentions/delegation)
      if (chunk.type === 'agent:invoke') {
        const targetAgentId = chunk.data.agentId;
        if (targetAgentId && targetAgentId !== agentId) {
          await onEvent(chunk, agentState);

          await coordinatorService.executeAgent({
            ...options,
            agentId: targetAgentId,
            event: chunk,
          });
          continue;
        }
      }

      if (chunk.type === 'agent:delegate') {
        const { agentId: targetAgentId, content } = chunk.data;
        const { threadId } = chunk.meta || {};

        const invokeEvent: OpenBotEvent = {
          type: 'agent:invoke',
          data: { content, agentId: targetAgentId },
          meta: { threadId },
        };

        await onEvent(chunk, agentState);

        await coordinatorService.executeAgent({
          ...options,
          agentId: targetAgentId,
          event: invokeEvent,
        });
        continue;
      }

      // 2. Propagate events to the caller
      await onEvent(chunk, agentState);

      if (chunk.type === 'agent:output') {
        hasProducedOutput = true;
      }
    }

    // 3. Fallback for agents that don't produce output
    if (event.type === 'agent:invoke' && !hasProducedOutput) {
      const warning = `⚠️ **${agentId}** is not configured to handle inputs. Please check its plugin configuration.`;

      await onEvent({ type: 'agent:output', data: { content: warning } }, agentState);
      await onEvent(
        {
          type: 'client:ui:message',
          data: {
            content: warning,
            role: 'assistant',
          },
          meta: { agentId },
        },
        agentState,
      );
    }
  },
};
