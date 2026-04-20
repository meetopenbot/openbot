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
async function createAgentRuntime(
  state: OpenBotState,
): Promise<Runtime<OpenBotState, OpenBotEvent>> {
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
    let currentThreadId = threadId;

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

      // 1. Store the user's input in the current context (main channel or existing thread)
      const initialState = await storageService.getOpenBotState({
        runId,
        agentId: 'system',
        channelId,
        threadId: currentThreadId,
        event: finalEvent,
      });

      // 2. Propagate the user's input to the event bus
      await onEvent(uiUserMessage, initialState);

      // 3. Detect mentions and trigger delegation/routing
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
            // The threadId in meta is the anchor for new threads (Slack-style)
            threadId: currentThreadId || uiUserMessage.id,
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
            // The threadId in meta is the anchor for new threads (Slack-style)
            threadId: currentThreadId || uiUserMessage.id,
          },
        };
      }
    }

    // 4. Linear Execution Loop
    // Instead of recursion, we use a queue to process agents one after another.
    const queue: { agentId: string; event: OpenBotEvent }[] = [
      { agentId: finalAgentId, event: finalEvent },
    ];

    // Safety check to prevent infinite loops
    let iterations = 0;
    const MAX_ITERATIONS = 20;

    while (queue.length > 0 && iterations < MAX_ITERATIONS) {
      iterations++;
      const { agentId, event: currentEvent } = queue.shift()!;

      // Track agents queued in this step to avoid double-runs (e.g. from tool + text mention)
      const queuedAgents = new Set<string>();
      const delegations: { agentId: string; event: OpenBotEvent }[] = [];

      await coordinatorService.executeAgent({
        runId,
        agentId,
        event: currentEvent,
        channelId,
        threadId: currentThreadId,
        onEvent: async (chunk, state) => {
          // 1. Detect if a new thread was created and update the context for the rest of the loop
          if (chunk.type === 'action:create_thread:result' && chunk.data.success) {
            currentThreadId = chunk.data.threadId || currentThreadId;
          }

          // 2. Detect delegations and mentions to queue them for the next iteration
          let targetAgentId: string | null = null;
          let targetEvent: OpenBotEvent | null = null;

          if (
            chunk.type === 'agent:invoke' &&
            chunk.data.agentId &&
            chunk.data.agentId !== agentId
          ) {
            targetAgentId = chunk.data.agentId;
            targetEvent = {
              ...chunk,
              meta: {
                ...(chunk.meta || {}),
                threadId: currentThreadId,
              },
            };
          } else if (chunk.type === 'agent:output') {
            const mention = parseMention(chunk.data.content);
            if (mention && mention.agentId !== agentId) {
              targetAgentId = mention.agentId;
              targetEvent = {
                type: 'agent:invoke',
                data: {
                  agentId: mention.agentId,
                  content: mention.stripped,
                },
                meta: {
                  threadId: currentThreadId,
                },
              };
            }
          }

          // 3. Queue only if not already queued in this step
          if (targetAgentId && targetEvent && !queuedAgents.has(targetAgentId)) {
            queuedAgents.add(targetAgentId);
            delegations.push({
              agentId: targetAgentId,
              event: targetEvent,
            });
          }

          // Propagate all events
          await onEvent(chunk, state);
        },
      });

      // Add found delegations to the queue
      queue.push(...delegations);
    }

    if (iterations >= MAX_ITERATIONS) {
      console.warn(`[coordinator] Reached MAX_ITERATIONS (${MAX_ITERATIONS}). Stopping execution.`);
    }
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
        await onEvent(
          {
            type: 'client:ui:message',
            data: {
              content: warning,
              role: 'assistant',
            },
            meta: { agentId: 'system', threadId },
          },
          fallbackState,
        );
        return;
      }
      throw error;
    }
    const agentRuntime = await createAgentRuntime(agentState);

    let hasProducedOutput = false;

    // RUN the agent runtime
    for await (const chunk of agentRuntime.run(event, { state: agentState, runId })) {
      await onEvent(chunk, agentState);

      if (chunk.type === 'agent:output') {
        hasProducedOutput = true;
      }
    }

    // Fallback for agents that don't produce output
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
