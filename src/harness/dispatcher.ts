import {
  AgentInvokeEvent,
  OpenBotEvent,
  OpenBotState,
  StopAgentRunEvent,
} from '../app/types.js';
import { ensureEventId } from '../app/utils.js';
import { storageService } from '../services/storage.js';
import { createAgentRuntime } from './runtime-factory.js';
import { advanceAfterRun } from './todo-advance.js';
import { isParticipantDispatchAllowed } from './channel-participants.js';

/**
 * Single entry point for every event arriving at the bus.
 *
 * Three flavors of dispatch:
 *
 *   1. `action:agent_run_stop` — record a stop signal, ack, done.
 *   2. `user:input` / `agent:invoke` — *agent step*: normalize, emit user-facing
 *      copy, then run the target agent with `run:start`/`run:end` bracketing,
 *      and a single `advanceAfterRun` pass that can chain the
 *      next assignee. Recursive, depth-bounded.
 *   3. Everything else — *bus pass-through*: run the event through the targeted
 *      agent's runtime once and forward emitted chunks. No `run:start`/`run:end`,
 *      no todo advance. This is what backs `/api/state` queries and
 *      out-of-band action events posted to `/api/publish`.
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
  /** Mutable: a `create_thread:result` mid-chain rebinds the rest of the chain. */
  threadId?: string;
  onEvent: DispatchOptions['onEvent'];
}

interface FollowUp {
  agentId: string;
  event: AgentInvokeEvent;
}

const MAX_CHAIN_DEPTH = 20;

// ---------------------------------------------------------------------------
// Stop requests
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
    await runStep({ agentId: options.agentId || 'system', event: invoke }, ctx, 0);
    return;
  }

  // Bus pass-through: route to the targeted agent's runtime once. No agent step,
  // no advance, no follow-ups. Keeps queries (`/api/state`) cheap and idempotent.
  await runBusEvent(event, options.agentId || 'system', ctx);
}

// ---------------------------------------------------------------------------
// Agent step: run:start -> runtime -> run:end -> advance -> chain
// ---------------------------------------------------------------------------

async function runStep(step: FollowUp, ctx: StepContext, depth: number): Promise<void> {
  if (depth >= MAX_CHAIN_DEPTH) {
    console.warn(`[dispatcher] Reached MAX_CHAIN_DEPTH (${MAX_CHAIN_DEPTH}); stopping chain.`);
    return;
  }

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
        agentId: 'system',
        event: step.event,
      });
      await ctx.onEvent(
        {
          type: 'agent:output',
          data: { content: `⚠️ Agent **${step.agentId}** does not exist. Please check the agent ID and try again.` },
          meta: { agentId: 'system', threadId: ctx.threadId },
        },
        fallback,
      );
      return;
    }
    throw error;
  }

  await ctx.onEvent({ type: 'agent:run:start', data: { ...target } }, state);

  const followUps: FollowUp[] = [];
  const queuedAgentIds = new Set<string>();
  let lastAgentOutput: string | undefined;
  /** Refreshed after the run for `agent:run:end` and participant-scoped follow-ups. */
  let stateAfterRun: OpenBotState = state;

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

      if (
        chunk.type === 'agent:output' &&
        (chunk.meta as { agentId?: string } | undefined)?.agentId === step.agentId
      ) {
        const content = chunk.data?.content;
        if (typeof content === 'string' && content.trim()) lastAgentOutput = content.trim();
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

  // Autonomous todo advance: single trigger point, runs once per `agent:run:end`.
  try {
    const handoff = await advanceAfterRun({
      storage: storageService,
      channelId: ctx.channelId,
      threadId: ctx.threadId,
      endedAgentId: step.agentId,
      lastAgentOutput,
    });
    const participants = stateAfterRun.channelDetails?.participants ?? [];
    if (
      handoff &&
      !queuedAgentIds.has(handoff.agentId) &&
      isParticipantDispatchAllowed(participants, step.agentId, handoff.agentId)
    ) {
      queuedAgentIds.add(handoff.agentId);
      followUps.push({
        agentId: handoff.agentId,
        event: makeInvoke(handoff.content, ctx.threadId),
      });
    }
  } catch (error) {
    console.warn('[dispatcher] todo advance failed', error);
  }

  for (const next of followUps) {
    await runStep(next, ctx, depth + 1);
  }
}

// ---------------------------------------------------------------------------
// Bus pass-through: run an event through the targeted agent's runtime, forward
// chunks. No run:start/end, no advance, no follow-ups.
// ---------------------------------------------------------------------------

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
    if ((error as Error & { code?: string }).code === 'AGENT_NOT_FOUND') {
      // Silently drop: bus pass-through has no UI surface to warn into.
      return;
    }
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function normalizeUserInput(
  event: OpenBotEvent,
  ctx: StepContext,
): Promise<AgentInvokeEvent> {
  const rawContent = (event as { data?: { content?: string } }).data?.content || '';

  // The user-facing copy stored/streamed for the UI.
  const userFacing: AgentInvokeEvent = {
    type: 'agent:invoke',
    id: event.id,
    data: { content: rawContent, role: 'user' },
    meta: {
      agentId: 'system',
      userId: event.meta?.userId,
      userName: event.meta?.userName,
      userAvatarUrl: event.meta?.userAvatarUrl,
    },
  };

  const initialState = await storageService.getOpenBotState({
    runId: ctx.runId,
    agentId: 'system',
    channelId: ctx.channelId,
    threadId: ctx.threadId,
    event: userFacing,
  });
  await ctx.onEvent(userFacing, initialState);

  // The event actually fed to the target agent. Carries the input threadId (or the
  // message id, used as the anchor for Slack-style new threads).
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

function makeInvoke(
  content: string,
  threadId?: string,
  baseMeta?: Record<string, unknown>,
): AgentInvokeEvent {
  return ensureEventId({
    type: 'agent:invoke',
    data: { role: 'user', content },
    meta: { ...(baseMeta || {}), threadId },
  } satisfies AgentInvokeEvent) as AgentInvokeEvent;
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
    agentId: options.agentId || 'system',
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
