import { melony, Runtime } from 'melony';
import { AgentInvokeEvent, OpenBotEvent, OpenBotState } from '../app/types.js';
import { resolvePlugin } from '../registry/plugins.js';
import { storageService } from '../services/storage.js';
import { ensureEventId } from '../app/utils.js';
import { loadConfig, PluginSpec } from '../app/config.js';

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
  agentId?: string;
  event: OpenBotEvent;
  channelId: string;
  threadId?: string;
  onEvent: (chunk: OpenBotEvent, state: OpenBotState) => Promise<void>;
}

/**
 * Enhances agent instructions with a list of other available agents.
 */
export async function enhanceInstructions(state: OpenBotState) {
  const { agentId, agentDetails } = state;
  if (!agentDetails) return;

  try {
    const agents = await storageService.getAgents();
    const otherAgents = agents.filter((a) => a.id !== agentId);
    if (otherAgents.length === 0) return;

    const agentsList = otherAgents
      .map((a) => `- **${a.id}**${a.description ? `: ${a.description}` : ''}`)
      .join('\n');

    const header = '### Available Agents for Delegation:';
    if (!agentDetails.instructions.includes(header)) {
      agentDetails.instructions += `\n\n${header}\n${agentsList}\n\nYou can use the \`delegate\` tool to task these agents. Use their ID (the bold part) when delegating.`;
    }
  } catch (error) {
    console.warn('[agent] Failed to enhance instructions', error);
  }
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
  });

  // 3. Normalize plugin specs:
  // - runtime can be a single spec or an array (for backward/forward compatibility)
  // - plugins remains supported as additional specs
  const runtimeSpecs = Array.isArray(state.agentDetails?.runtime)
    ? state.agentDetails.runtime
    : state.agentDetails?.runtime
      ? [state.agentDetails.runtime]
      : [];
  const { globalPlugins = [] } = loadConfig();
  const agentSpecs = [...runtimeSpecs, ...(state.agentDetails?.plugins || [])];
  const pluginSpecs = mergePluginSpecs(globalPlugins, agentSpecs);

  // 4. Load normalized plugins
  for (const p of pluginSpecs) {
    const name = typeof p === 'string' ? p : p?.name;
    if (!name || typeof name !== 'string') {
      continue;
    }

    const config = typeof p === 'string' ? {} : { ...(p.config || {}) };
    const plugin = await resolvePlugin(name, config);
    if (plugin) {
      runtime.use(plugin);
    }
  }

  return runtime.build();
}

function mergePluginSpecs(globalSpecs: PluginSpec[], agentSpecs: PluginSpec[]): PluginSpec[] {
  const specsByName = new Map<string, PluginSpec>();

  for (const spec of globalSpecs) {
    const name = typeof spec === 'string' ? spec : spec?.name;
    if (!name || typeof name !== 'string') continue;
    specsByName.set(name, spec);
  }

  // Agent-defined plugins override global ones with the same name.
  for (const spec of agentSpecs) {
    const name = typeof spec === 'string' ? spec : spec?.name;
    if (!name || typeof name !== 'string') continue;
    specsByName.set(name, spec);
  }

  return [...specsByName.values()];
}

export const orchestratorService = {
  /**
   * The primary entry point for all events coming into the system (e.g. from the API).
   * Handles routing and initial UI message creation.
   */
  dispatch: async (options: DispatchOptions): Promise<void> => {
    const { runId, agentId, event, channelId, threadId, onEvent } = options;

    // 0. Ensure the incoming event has a unique ID immediately
    ensureEventId(event);

    let finalAgentId = agentId || 'system';
    let finalEvent = event;
    let currentThreadId = threadId;

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
        threadId: currentThreadId,
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
          threadId: currentThreadId || finalEvent.id,
        },
      };
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

      // Track agents queued in this step to avoid double-runs (e.g. from tool delegation)
      const queuedAgents = new Set<string>();
      const delegations: { agentId: string; event: OpenBotEvent }[] = [];

      await orchestratorService.executeAgent({
        runId,
        agentId,
        event: currentEvent,
        channelId,
        threadId: currentThreadId,
        onEvent: async (chunk, state) => {
          // 0. Filter out echoed input events to prevent duplication in the UI/storage
          if (chunk.type === currentEvent.type && chunk.id === currentEvent.id) {
            return;
          }

          // 1. Detect if a new thread was created and update the context for the rest of the loop
          if (chunk.type === 'action:create_thread:result' && chunk.data.success) {
            currentThreadId = chunk.data.threadId || currentThreadId;
          }

          // 2. Detect delegations to queue them for the next iteration
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
      console.warn(
        `[orchestrator] Reached MAX_ITERATIONS (${MAX_ITERATIONS}). Stopping execution.`,
      );
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

        return;
      }
      throw error;
    }
    const agentRuntime = await createAgentRuntime(agentState);

    await onEvent(
      {
        type: 'agent:run:start',
        data: {
          runId,
          agentId,
          channelId,
          threadId,
        },
      },
      agentState,
    );

    try {
      // RUN the agent runtime
      for await (const chunk of agentRuntime.run(event, { state: agentState, runId })) {
        chunk.meta = { ...chunk.meta, agentId };

        await onEvent(chunk, agentState);
      }
    } finally {
      await onEvent(
        {
          type: 'agent:run:end',
          data: {
            runId,
            agentId,
            channelId,
            threadId,
          },
        },
        agentState,
      );
    }
  },
};
