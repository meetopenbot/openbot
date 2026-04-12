import { Runtime } from "melony";
import { ConversationEvent, ConversationState } from "./types.js";

/**
 * Resolves the Melony `state` object for an agent. All agents share the same root
 * conversation state for shared context and project visibility.
 */
export function resolveAgentRuntimeState(
  root: ConversationState,
  _agentId: string,
): ConversationState {
  return root;
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

/**
 * Finds the first @mention in a text string and checks if it's a valid agent.
 */
export function findFirstMention(text: string, agentIds: string[]): string | undefined {
  if (!text) return undefined;
  const mentionPattern = /@([a-z0-9-_]+)/gi;
  let match;
  while ((match = mentionPattern.exec(text)) !== null) {
    const mention = match[1].toLowerCase();
    if (agentIds.includes(mention)) {
      return mention;
    }
  }
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

  // --- 0. SYSTEM ROUTING ---
  // If the event type doesn't look like a standard chat event, route it to system.
  const isChatEvent =
    event.type === "user:input" ||
    event.type === "agent:invoke" ||
    event.type === "agent:handoff" ||
    event.type === "message:reaction" ||
    event.type === "run:started" ||
    event.type === "run:cancelled";

  if (!isChatEvent && event.type.includes(":")) {
    const system = agentRuntimes.get("system");
    if (system) {
      for await (const chunk of system.run(event, {
        runId: context.runId,
        state,
      })) {
        yield chunk;
      }
      return;
    }
  }

  // --- 1. DISPATCHER: Determine the target agent for this message ---
  let targetAgentId: string | undefined = event.meta?.agentId;

  // If the event is an user:input and not a delegation, determine the target agent.
  if (event.type === "user:input" && !event.meta?.delegation) {
    const agentIds = Array.from(agentRuntimes.keys());
    const content = event.data?.content || "";
    const mention = findFirstMention(content, agentIds);

    if (conversationId.startsWith("channel_")) {
      // Channels: route to the first @mentioned agent, or fall back to "default".
      targetAgentId = mention || "default";
    } else if (conversationId.startsWith("dm_")) {
      targetAgentId = conversationId.slice("dm_".length);
    }
  }

  /** True when no concrete agent id (no runtime) or virtual lead "you". */
  const isTargetingLead = !targetAgentId || targetAgentId === "you";

  // --- 2. EXECUTION: Run the target agent ---
  const runtime = targetAgentId ? agentRuntimes.get(targetAgentId) : undefined;

  // For non-input events with an explicit agentId, always try that agent first
  if (event.type !== "user:input" && event.meta?.agentId) {
    const explicitRuntime = agentRuntimes.get(event.meta.agentId);
    if (explicitRuntime) {
      const target = event.meta.agentId;
      const targetState = resolveAgentRuntimeState(state, target);
      (targetState as any).conversationId = state.conversationId;
      (targetState as any).agentId = target;

      for await (const agentChunk of explicitRuntime.run(event, {
        runId: context.runId,
        state: targetState as any,
      })) {
        yield {
          ...agentChunk,
          meta: { ...(agentChunk as any)?.meta, agentId: target },
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
        ...(targetAgentId ? { agentId: targetAgentId } : {}),
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
            meta: { agentId: targetAgentId },
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
