import { melony } from 'melony';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import { ensureEventId } from '../app/utils.js';
import { storageService } from '../plugins/storage/service.js';
import { STATE_AGENT_ID, ORCHESTRATOR_AGENT_ID } from '../app/agent-ids.js';
import { resolvePlugin } from '../services/plugins/registry.js';
import { ToolDefinition } from '../services/plugins/types.js';
import { abortRegistry, abortKey } from '../services/abort.js';
import { loadConfig } from '../app/config.js';
import { getPublicBaseUrl } from '../plugins/storage/files.js';

export { STATE_AGENT_ID, ORCHESTRATOR_AGENT_ID };

export interface RunAgentOptions {
  runId: string;
  agentId: string;
  event: OpenBotEvent;
  channelId: string;
  threadId?: string;
  persistEvents?: boolean;
  /** Resolved public base URL for the server. */
  publicBaseUrl?: string;
  onEvent: (event: OpenBotEvent, state?: OpenBotState) => Promise<void>;
}

async function emitEvent(
  chunk: OpenBotEvent,
  state: OpenBotState | undefined,
  {
    persistEvents,
    channelId,
    threadId,
    onEvent,
    parentAgentId,
    parentToolCallId,
  }: {
    persistEvents: boolean;
    channelId: string;
    threadId?: string;
    onEvent: RunAgentOptions['onEvent'];
    parentAgentId?: string;
    parentToolCallId?: string;
  },
): Promise<void> {
  ensureEventId(chunk);

  // Enrich event with parent metadata if not already present
  if (parentAgentId || parentToolCallId) {
    chunk.meta = {
      ...chunk.meta,
      parentAgentId: chunk.meta?.parentAgentId || parentAgentId,
      parentToolCallId: chunk.meta?.parentToolCallId || parentToolCallId,
    };
  }

  if (persistEvents) {
    await storageService.storeEvent({
      channelId: state?.channelId || channelId,
      threadId: state?.threadId || threadId,
      event: chunk,
    });
  }

  await onEvent(chunk, state);
}

/**
 * Runs a single agent turn.
 * Fire and forget.
 */
export async function runAgent(options: RunAgentOptions): Promise<void> {
  const { runId, agentId, event, channelId, threadId, onEvent } = options;
  const persistEvents = options.persistEvents !== false;

  let publicBaseUrl = options.publicBaseUrl;
  if (!publicBaseUrl) {
    const config = loadConfig();
    const port = Number(config.port ?? process.env.PORT ?? 4132);
    publicBaseUrl = getPublicBaseUrl(port, config.publicUrl);
  }

  const parentAgentId = event.meta?.parentAgentId;
  const parentToolCallId = event.meta?.parentToolCallId;

  const agentDetails = await storageService.getAgentDetails({ agentId });

  const state = await storageService.getOpenBotState({
    runId,
    agentId,
    channelId,
    threadId,
    event,
  });

  // Shared per-thread abort signal so a stop request cancels this run and any
  // delegated sub-agent runs (which execute in the same channel/thread).
  const runKey = abortKey(channelId, threadId);
  const abortSignal = abortRegistry.acquire(runKey);

  await emitEvent(
    {
      type: 'agent:run:start',
      data: { runId, agentId, channelId, threadId },
    } as OpenBotEvent,
    state,
    { persistEvents, channelId, threadId, onEvent, parentAgentId, parentToolCallId },
  );

  try {
    const pluginRefs = agentDetails.pluginRefs ?? [];
    const tools: Record<string, ToolDefinition> = {};

    for (const ref of pluginRefs) {
      const plugin = await resolvePlugin(ref.id);
      if (plugin?.toolDefinitions) {
        Object.assign(tools, plugin.toolDefinitions);
      }
    }

    const builder = melony<OpenBotState, OpenBotEvent>().initialState(state);

    for (const ref of pluginRefs) {
      const plugin = await resolvePlugin(ref.id);
      if (!plugin) continue;

      builder.use(
        plugin.factory({
          agentId,
          agentDetails,
          config: ref.config ?? {},
          storage: storageService,
          tools,
          publicBaseUrl,
          abortSignal,
        }),
      );
    }

    const runtime = builder.build();
    const generator = runtime.run(event, { runId, state });

    for await (const outputEvent of generator) {
      if (abortSignal.aborted) break;
      await emitEvent(outputEvent, state, {
        persistEvents,
        channelId,
        threadId,
        onEvent,
        parentAgentId,
        parentToolCallId,
      });
    }
  } catch (error) {
    console.error(`[harness] Error running agent ${agentId}:`, error);
  } finally {
    abortRegistry.release(runKey);
    await emitEvent(
      {
        type: 'agent:run:end',
        data: { runId, agentId, channelId, threadId },
      } as OpenBotEvent,
      state,
      { persistEvents, channelId, threadId, onEvent, parentAgentId, parentToolCallId },
    );
  }
}
