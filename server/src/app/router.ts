import { Runtime } from "melony";
import { ConversationEvent, ConversationState } from "./types.js";

/**
 * Legacy channel sessions stored the lead ("default") under agentStates.default.
 * Hoist that slice onto the root conversation state once so cwd, conversationId,
 * messages, and tool state stay on the same object the runtime uses.
 */
function hoistChannelDefaultAgentSlice(root: ConversationState) {
  const nested = root.agentStates?.default;
  if (!nested || typeof nested !== "object") return;

  const nm = nested.messages;
  if (Array.isArray(nm) && nm.length > 0) {
    if (!root.messages || root.messages.length === 0) {
      root.messages = nm;
    }
    delete (nested as { messages?: unknown }).messages;
  }
}

/**
 * Resolves the Melony `state` object for an agent. Channel lead uses the root
 * conversation state; other agents use an isolated agentStates entry.
 */
export function resolveAgentRuntimeState(
  root: ConversationState,
  agentId: string,
): ConversationState {
  if (agentId === "you") {
    return root;
  }
  const cid = root.conversationId || "";
  if (agentId === "default" && cid.startsWith("channel_")) {
    if (!root.agentStates) root.agentStates = {};
    hoistChannelDefaultAgentSlice(root);
    return root;
  }
  if (!root.agentStates) root.agentStates = {};
  return (root.agentStates[agentId] ??= {}) as ConversationState;
}

export function summarizeAgentEventValue(event: any): string | undefined {
  if (!event) return undefined;

  // For suspensions, provide a more descriptive summary so delegation feedback isn't empty.
  if (event.type === 'suspend') {
    const reason = event.data?.reason ?? 'waiting for action';
    return `The agent is suspended (${reason}) and needs your approval. Use the approval buttons in the chat to continue.`;
  }

  const value =
    event?.data?.result ??
    event?.data?.content ??
    event?.data?.message ??
    event?.data;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null)
    return JSON.stringify(value, null, 2);
  return undefined;
}

export async function* runOpenBot(
  event: ConversationEvent,
  context: { runId: string; state: ConversationState },
  agentRuntimes: Map<string, Runtime<ConversationState, ConversationEvent>>,
) {
  const { state } = context;
  const conversationId = state.conversationId || "";

  // Initialize state
  if (!state.messages) state.messages = [];
  if (!state.agentStates) state.agentStates = {};

  // --- 1. DISPATCHER: Determine the target agent for this message ---
  let targetAgentId: string | undefined = event.meta?.agentName;

  // If the event is an agent:input and not a delegation, determine the target agent.
  if (event.type === "agent:input" && !event.meta?.delegation) {
    if (conversationId.startsWith("channel_")) {
      // Channels: always the default agent at the top level; use `delegate` for other agents.
      targetAgentId = "default";
    } else if (conversationId.startsWith("dm_")) {
      targetAgentId = conversationId.slice("dm_".length);
    }
  }

  /** True when no concrete agent id (no runtime) or virtual lead "you". */
  const isTargetingLead = !targetAgentId || targetAgentId === "you";

  // --- 2. EXECUTION: Run the target agent ---
  const runtime = targetAgentId ? agentRuntimes.get(targetAgentId) : undefined;

  // For non-input events with an explicit agentName, always try that agent first
  if (event.type !== "agent:input" && event.meta?.agentName) {
    const explicitRuntime = agentRuntimes.get(event.meta.agentName);
    if (explicitRuntime) {
      const target = event.meta.agentName;
      const targetState = resolveAgentRuntimeState(state, target);
      (targetState as any).conversationId = state.conversationId;
      (targetState as any).agentId = target;

      for await (const agentChunk of explicitRuntime.run(event, {
        runId: context.runId,
        state: targetState as any,
      })) {
        yield {
          ...agentChunk,
          meta: { ...(agentChunk as any)?.meta, agentName: target },
        } as ConversationEvent;
      }
      return;
    }
  }

  // Run the resolved runtime
  if (runtime) {
    const targetState = resolveAgentRuntimeState(state, targetAgentId!);
    let lastOutput = "";
    (targetState as any).conversationId = state.conversationId;
    (targetState as any).agentId = targetAgentId;

    for await (const chunk of runtime.run(event, {
      runId: context.runId,
      state: targetState as any,
    })) {
      if (
        chunk.type === "agent:output" ||
        chunk.type === "agent:output-delta" ||
        chunk.type === "suspend"
      ) {
        const summary = summarizeAgentEventValue(chunk);
        if (summary) lastOutput = summary;
      }

      const outMeta = {
        ...chunk.meta,
        ...(targetAgentId ? { agentName: targetAgentId } : {}),
      };

      if (chunk.type === "suspend") {
        const nested = (chunk as any).data?.event;
        if (nested?.type === "ui") {
          yield {
            ...nested,
            data: { ...nested.data, placement: "inline" },
            meta: { ...nested.meta, ...outMeta },
          } as ConversationEvent;
        }
      }

      yield { ...chunk, meta: outMeta } as ConversationEvent;
    }

    if (!isTargetingLead && !state.title && lastOutput) {
      const titleRuntime = targetAgentId
        ? agentRuntimes.get(targetAgentId)
        : undefined;

      if (titleRuntime) {
        const genState = resolveAgentRuntimeState(state, targetAgentId!);
        (genState as any).conversationId = state.conversationId;
        (genState as any).agentId = targetAgentId;

        for await (const _ of titleRuntime.run(
          {
            type: "agent:output",
            meta: { agentName: targetAgentId },
            data: { content: lastOutput },
          } as ConversationEvent,
          { runId: context.runId, state: genState as any },
        )) {
          // side-effects only (topic agent)
        }
      }
    }
  }
}
