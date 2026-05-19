import {
  AgentInvokeEvent,
  OpenBotEvent,
  OpenBotState,
  StopAgentRunEvent,
  TodoItem,
  TodoStatus,
} from '../app/types.js';
import { ensureEventId } from '../app/utils.js';
import { storageService } from '../services/storage.js';
import { createAgentRuntime } from './runtime-factory.js';
import { ORCHESTRATOR_AGENT_ID } from './context.js';

/**
 * Single entry point for every event arriving at the bus.
 *
 * Agent steps (`user:input` / `agent:invoke`) run one orchestrator turn.
 * Worker runs are triggered by the orchestrator via `delegate_to_agent` during
 * that turn (see bus/services), not queued in thread state afterward.
 */

export interface DispatchOptions {
  runId: string;
  agentId?: string;
  event: OpenBotEvent;
  channelId: string;
  threadId?: string;
  onEvent: (chunk: OpenBotEvent, state: OpenBotState) => Promise<boolean | void>;
}

interface StepContext {
  runId: string;
  channelId: string;
  threadId?: string;
  onEvent: DispatchOptions['onEvent'];
}

interface AgentStep {
  agentId: string;
  event: AgentInvokeEvent;
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

const findStopRequest = (target: {
  runId: string;
  agentId: string;
  channelId: string;
  threadId?: string;
}): StopRequest | undefined => {
  pruneStopRequests();
  return stopRequests.find((r) => {
    if (r.runId !== target.runId) return false;
    if (r.agentId && r.agentId !== target.agentId) return false;
    if (r.channelId && r.channelId !== target.channelId) return false;
    if (r.threadId && r.threadId !== target.threadId) return false;
    return true;
  });
};

const readThreadState = (state: OpenBotState): Record<string, unknown> =>
  (state.threadDetails?.state as Record<string, unknown> | undefined) ?? {};

const readTodos = (state: OpenBotState): TodoItem[] => {
  const raw = readThreadState(state).todos;
  return Array.isArray(raw) ? (raw as TodoItem[]) : [];
};

/** Cancel open todos when the user starts a new message (fresh intent). */
async function clearPlanOnNewUserMessage(state: OpenBotState): Promise<void> {
  if (!state.threadId) return;
  const todos = readTodos(state);
  if (todos.length === 0) return;

  const now = Date.now();
  const closedTodos = todos.map((t) => {
    if (t.status === 'pending' || t.status === 'in_progress') {
      return { ...t, status: 'cancelled' as TodoStatus, updatedAt: now };
    }
    return t;
  });

  await storageService.patchThreadState({
    channelId: state.channelId,
    threadId: state.threadId,
    state: { todos: closedTodos, orchestration: null },
  });
}

export async function dispatch(options: DispatchOptions): Promise<void> {
  const { event } = options;
  ensureEventId(event);

  if (event.type === 'action:agent_run_stop') {
    await handleStop(event as StopAgentRunEvent, options);
    return;
  }

  const ctx: StepContext = {
    runId: options.runId,
    channelId: options.channelId,
    threadId: options.threadId,
    onEvent: options.onEvent,
  };

  if (event.type === 'user:input' || event.type === 'agent:invoke') {
    const invoke = await normalizeUserInput(event, ctx);
    await runOrchestratorStep({ agentId: options.agentId || ORCHESTRATOR_AGENT_ID, event: invoke }, ctx);
    return;
  }

  await runBusEvent(event, options.agentId || ORCHESTRATOR_AGENT_ID, ctx);
}

async function runOrchestratorStep(step: AgentStep, ctx: StepContext): Promise<void> {
  const target = {
    runId: ctx.runId,
    agentId: step.agentId,
    channelId: ctx.channelId,
    threadId: ctx.threadId,
  };

  const preStop = findStopRequest(target);
  if (preStop) {
    const state = await storageService.getOpenBotState({ ...target, event: step.event });
    await ctx.onEvent(
      { type: 'agent:run:stopped', data: { ...target, reason: preStop.reason } },
      state,
    );
    return;
  }

  let state: OpenBotState;
  try {
    state = await storageService.getOpenBotState({ ...target, event: step.event });
  } catch (error) {
    if ((error as Error & { code?: string }).code === 'AGENT_NOT_FOUND') {
      const fallback = await storageService.getOpenBotState({
        ...target,
        agentId: ORCHESTRATOR_AGENT_ID,
        event: step.event,
      });
      await ctx.onEvent(
        {
          type: 'agent:output',
          data: {
            content: `⚠️ Agent **${step.agentId}** does not exist. Use participant ids without an @ prefix.`,
          },
          meta: { agentId: ORCHESTRATOR_AGENT_ID, threadId: ctx.threadId },
        },
        fallback,
      );
      return;
    }
    throw error;
  }

  await ctx.onEvent({ type: 'agent:run:start', data: { ...target } }, state);

  let stateAfterRun = state;

  try {
    const runtime = await createAgentRuntime(state);

    for await (const chunk of runtime.run(step.event, { state, runId: ctx.runId })) {
      const stop = findStopRequest(target);
      if (stop) {
        await ctx.onEvent(
          { type: 'agent:run:stopped', data: { ...target, reason: stop.reason } },
          state,
        );
        break;
      }

      if (chunk.id === step.event.id && chunk.type === step.event.type) continue;

      if (chunk.type === 'action:create_thread:result' && chunk.data.success) {
        ctx.threadId = chunk.data.threadId || ctx.threadId;
      }

      chunk.meta = { ...chunk.meta, agentId: step.agentId };
      await ctx.onEvent(chunk, state);
    }
  } catch (error) {
    console.error(`[dispatcher] Agent run failed: ${step.agentId}`, error);
  } finally {
    stateAfterRun = await storageService.getOpenBotState({ ...target, event: step.event });
    await ctx.onEvent({ type: 'agent:run:end', data: { ...target } }, stateAfterRun);
  }

}

async function runBusEvent(
  event: OpenBotEvent,
  agentId: string,
  ctx: StepContext,
): Promise<void> {
  let state: OpenBotState;
  try {
    state = await storageService.getOpenBotState({
      runId: ctx.runId,
      agentId,
      channelId: ctx.channelId,
      threadId: ctx.threadId,
      event,
    });
  } catch (error) {
    if ((error as Error & { code?: string }).code === 'AGENT_NOT_FOUND') return;
    throw error;
  }

  try {
    const runtime = await createAgentRuntime(state);
    for await (const chunk of runtime.run(event, { state, runId: ctx.runId })) {
      if (chunk.id === event.id && chunk.type === event.type) continue;
      chunk.meta = { ...chunk.meta, agentId };
      await ctx.onEvent(chunk, state);
    }
  } catch (error) {
    console.error(`[dispatcher] Bus event failed: ${event.type} (${agentId})`, error);
  }
}

async function normalizeUserInput(
  event: OpenBotEvent,
  ctx: StepContext,
): Promise<AgentInvokeEvent> {
  const rawContent = (event as { data?: { content?: string } }).data?.content || '';

  const userFacing: AgentInvokeEvent = {
    type: 'agent:invoke',
    id: event.id,
    data: { content: rawContent, role: 'user' },
    meta: {
      agentId: ORCHESTRATOR_AGENT_ID,
      userId: event.meta?.userId,
      userName: event.meta?.userName,
      userAvatarUrl: event.meta?.userAvatarUrl,
    },
  };

  const initialState = await storageService.getOpenBotState({
    runId: ctx.runId,
    agentId: ORCHESTRATOR_AGENT_ID,
    channelId: ctx.channelId,
    threadId: ctx.threadId,
    event: userFacing,
  });
  if (event.type === 'user:input') {
    await clearPlanOnNewUserMessage(initialState);
  }
  await ctx.onEvent(userFacing, initialState);

  return {
    ...(event as AgentInvokeEvent),
    type: 'agent:invoke',
    data: { ...((event as AgentInvokeEvent).data || {}), content: rawContent, role: 'user' },
    meta: {
      ...(event.meta || {}),
      threadId: ctx.threadId || event.id,
    },
  };
}

async function handleStop(stopEvent: StopAgentRunEvent, options: DispatchOptions): Promise<void> {
  const { runId, channelId, threadId, onEvent } = options;
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
    agentId: options.agentId || ORCHESTRATOR_AGENT_ID,
    channelId,
    threadId,
    event: stopEvent,
  });
  await onEvent(
    {
      type: 'action:agent_run_stop:result',
      data: { success: true, message: `Stop requested for run ${stopEvent.data.runId}.` },
      meta: stopEvent.meta,
    },
    state,
  );
}
