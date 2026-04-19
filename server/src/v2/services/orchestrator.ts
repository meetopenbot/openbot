import { createOpenBotRuntime } from '../app/open-bot.js';
import { OpenBotEvent, OpenBotState, ShortTermMessage } from '../app/types.js';
import { AgentDetails, ChannelDetails, ThreadDetails } from '../plugins/storage.js';
import { threadToolDefinitions } from '../plugins/threads.js';
import { storageService } from './storage.js';

export interface ExecuteAgentOptions {
  runId: string;
  agentId: string;
  event: OpenBotEvent;
  channelId: string;
  threadId?: string;
  onEvent: (chunk: OpenBotEvent, state: OpenBotState) => Promise<void>;
}

export const orchestratorService = {
  /**
   * Executes an agent runtime and handles recursive delegation.
   */
  executeAgent: async (options: ExecuteAgentOptions): Promise<void> => {
    const { runId, agentId, event, channelId, threadId, onEvent } = options;

    // agent details
    let agentDetails;
    if (agentId === 'system') {
      agentDetails = {
        name: 'OpenBot',
        instructions:
          'You are OpenBot, the primary AI assistant and orchestrator of this workspace. Your goal is to help users onboard, answer questions about the system, and suggest specialized agents for specific tasks.\n\n' +
          '### How to use OpenBot:\n' +
          '1. **General Chat**: Just type your message here, and I will help you.\n' +
          '2. **Specialized Agents**: You can @mention specialized agents for specific tasks. For example, use `@os` for terminal commands and file operations.\n' +
          '3. **Channels**: Channels are shared spaces where multiple agents can participate. You can create new channels for different topics.\n' +
          '4. **Local-First**: OpenBot runs entirely on your machine. Your data stays private and local.\n\n' +
          'If you need to know what agents or plugins are installed, I can help you find that information.',
        plugins: [
          {
            name: 'ai-sdk',
            config: {
              model: 'openai/gpt-4o-mini',
              toolDefinitions: { ...threadToolDefinitions },
            },
          },
          { name: 'storage', config: { storage: storageService } },
          { name: 'threads', config: {} },
        ],
      };
    } else {
      try {
        agentDetails = await storageService.getAgentDetails({ agentId });
      } catch (error) {
        console.warn(`[orchestrator] Failed to load agent details for agent: ${agentId}`, error);
      }
    }

    let channelDetails;
    // channel spec and state
    if (channelId && channelId !== 'default') {
      try {
        channelDetails = await storageService.getChannelDetails({ channelId });
      } catch (error) {
        console.warn(
          `[orchestrator] Failed to load channel details for channel ${channelId}`,
          error,
        );
      }
    }

    let threadDetails;
    if (channelId && threadId) {
      try {
        threadDetails = await storageService.getThreadDetails({ channelId, threadId });
      } catch (error) {
        console.warn(
          `[orchestrator] Failed to load thread details for channel ${channelId} thread: ${threadId}`,
          error,
        );
      }
    }

    // Keep a small recent message window as short-term memory for the LLM.
    const shortTermMessages = await (async (): Promise<ShortTermMessage[]> => {
      try {
        const events = await storageService.getEvents({ channelId, threadId });
        return events
          .filter(
            (e): e is Extract<OpenBotEvent, { type: 'client:ui:message' }> =>
              e.type === 'client:ui:message',
          )
          .map((e) => ({
            role: e.data.role,
            content: e.data.content,
          }))
          .filter((m) => m.content?.trim().length > 0)
          .slice(-20);
      } catch (error) {
        console.warn(
          `[orchestrator] Failed to load short-term memory for channel ${channelId} thread ${threadId}`,
          error,
        );
        return [];
      }
    })();

    // Single state object for the run. Melony clones `initialState` via structuredClone when
    // `run()` is called without `options.state`; plugin configs may hold Zod schemas or other
    // non-cloneable values, so we always pass this reference into `run()` to skip cloning.
    const agentState: OpenBotState = {
      runId,
      agentId,
      channelId,
      threadId,
      triggerEvent: event,
      agentDetails: agentDetails as AgentDetails,
      channelDetails: channelDetails as ChannelDetails,
      threadDetails: threadDetails as ThreadDetails,
      shortTermMessages,
    };

    const agentRuntime = await createOpenBotRuntime({
      state: agentState,
    });

    let hasProducedOutput = false;
    let hasInvokedOther = false;

    // RUN
    for await (const chunk of agentRuntime.run(event, { state: agentState, runId })) {
      // EVENT
      await onEvent(chunk, agentState);

      // has produced output
      if (chunk.type === 'agent:output') {
        hasProducedOutput = true;
      }

      // Recursive invocation handling
      if (chunk.type === 'agent:invoke') {
        const { agentId: targetAgentId } = chunk.data;

        // If the runtime yielded an event targeting a DIFFERENT agent, we recurse.
        if (targetAgentId && targetAgentId !== agentId) {
          hasInvokedOther = true;
          await orchestratorService.executeAgent({
            ...options,
            agentId: targetAgentId,
            event: chunk,
          });
        }
      }
    }

    // If the event was an agent:invoke but no output or further invocation was yielded,
    // the agent is likely misconfigured (e.g., missing an LLM plugin).
    if (event.type === 'agent:invoke' && !hasProducedOutput && !hasInvokedOther) {
      await onEvent(
        {
          type: 'agent:output',
          data: {
            content: `⚠️ **${agentId}** is not configured to handle inputs. Please check its plugin configuration (e.g., missing \`ai-sdk\`).`,
          },
        },
        agentState,
      );

      await onEvent(
        {
          type: 'client:ui:message',
          data: {
            content: `⚠️ **${agentId}** is not configured to handle inputs. Please check its plugin configuration (e.g., missing \`ai-sdk\`).`,
            role: 'assistant',
          },
          meta: {
            agentId,
          },
        },
        agentState,
      );
    }
  },
};
