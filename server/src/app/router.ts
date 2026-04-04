import { Runtime } from "melony";
import { ConversationEvent, ConversationState } from "./types.js";
import { PluginRegistry } from "../registry/plugin-registry.js";

function summarizeAgentEventValue(event: any): string | undefined {
  if (!event) return undefined;
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

/** Avoid treating `@` inside emails/identifiers (e.g. `user@domain.com`) as a mention. */
function isMentionAtSign(content: string, atIndex: number): boolean {
  if (atIndex === 0) return true;
  return !/[a-zA-Z0-9]/.test(content[atIndex - 1]!);
}

/** True if the character after a matched id/name is a valid mention terminator (not a continuation of the handle). */
function isAgentMentionBoundary(nextChar: string | undefined): boolean {
  if (nextChar === undefined) return true;
  if (/\s/.test(nextChar)) return true;
  return ",;.:!?)]}'\"`".includes(nextChar);
}

type ListedAgent = { id: string; name: string };

/**
 * First `@…` in the string that resolves to a registered agent (longest-prefix wins per position).
 * Returns slice indices: `start` at `@`, `end` after the matched handle (exclusive).
 */
function findFirstAgentMention(
  content: string,
  agents: ListedAgent[],
): { agentId: string; start: number; end: number } | null {
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== "@") continue;
    if (!isMentionAtSign(content, i)) continue;
    const afterAt = content.slice(i + 1);
    if (!afterAt) continue;

    let best: { id: string; prefixLength: number } | undefined;
    for (const agent of agents) {
      const idMatches = afterAt.toLowerCase().startsWith(agent.id.toLowerCase());
      const nameMatches = afterAt.toLowerCase().startsWith(agent.name.toLowerCase());
      if (!idMatches && !nameMatches) continue;

      const matchPrefix = idMatches ? agent.id : agent.name;
      const prefixLength = matchPrefix.length;
      const nextChar = afterAt[prefixLength];
      if (!isAgentMentionBoundary(nextChar)) continue;

      if (!best || prefixLength > best.prefixLength) {
        best = { id: agent.id, prefixLength };
      }
    }

    if (best) {
      return { agentId: best.id, start: i, end: i + 1 + best.prefixLength };
    }
  }
  return null;
}

export async function* runOpenBot(
  event: ConversationEvent,
  context: { runId: string; state: ConversationState },
  agentRuntimes: Map<string, Runtime<ConversationState, ConversationEvent>>,
  registry: PluginRegistry,
) {
  const { state } = context;
  const threadId = event.meta?.threadId;
  const conversationId = state.conversationId || "";
  const allAgents = registry.getAgents();

  // Initialize state
  if (!state.messages) state.messages = [];
  if (!state.agentStates) state.agentStates = {};
  if (!state.threadAssignees) state.threadAssignees = {};

  // --- 1. DISPATCHER: Determine the target agent for this message ---
  let targetAgentId: string | undefined = event.meta?.agentName;

  if (event.type === "agent:input") {
    const content = (event.data as any).content as string;

    // A. First @mention anywhere in the message (single agent; longest-prefix wins at that @)
    if (typeof content === "string" && content.length > 0) {
      const mention = findFirstAgentMention(content, allAgents);
      if (mention) {
        targetAgentId = mention.agentId;
        const before = content.slice(0, mention.start);
        const after = content.slice(mention.end);
        const stripped = `${before}${after}`.replace(/\s{2,}/g, " ").trim();
        event.data = { ...event.data, content: stripped || "Hello" } as any;
      }
    }

    // B. Thread Assignee
    if (!targetAgentId && threadId && state.threadAssignees[threadId]) {
      targetAgentId = state.threadAssignees[threadId];
    }

    // C. DM Context
    if (!targetAgentId && conversationId.startsWith("dm_")) {
      targetAgentId = conversationId.slice("dm_".length);
    }

    // D. Channel fallback — route to the default agent
    if (!targetAgentId && conversationId.startsWith("channel_")) {
      targetAgentId = "default";
    }
  }

  // Persist the thread→agent mapping so subsequent replies auto-route
  if (threadId && targetAgentId && targetAgentId !== "default" && !state.threadAssignees[threadId]) {
    state.threadAssignees[threadId] = targetAgentId;
  }

  const isTargetingLead = !targetAgentId || targetAgentId === "you";

  // --- 2. EXECUTION: Run the target agent ---
  const runtime = targetAgentId ? agentRuntimes.get(targetAgentId) : undefined;

  // For non-input events with an explicit agentName, always try that agent first
  if (event.type !== "agent:input" && event.meta?.agentName) {
    const explicitRuntime = agentRuntimes.get(event.meta.agentName);
    if (explicitRuntime) {
      const target = event.meta.agentName;
      const isLead = target === "you";
      const targetState = isLead ? state : (state.agentStates[target] ||= {});

      for await (const agentChunk of explicitRuntime.run(event, {
        runId: context.runId,
        state: targetState as any,
        agentId: target, // Pass our identity in context
      } as any)) {
        yield {
          ...agentChunk,
          meta: {
            ...(agentChunk as any)?.meta,
            ...(threadId ? { threadId } : {}),
            agentName: target,
          },
        } as ConversationEvent;
      }
      return;
    }
  }

  // Run the resolved runtime
  if (runtime) {
    const targetState = isTargetingLead
      ? state
      : (state.agentStates[targetAgentId!] ||= {});
    let lastOutput = "";

    for await (const chunk of runtime.run(event, {
      runId: context.runId,
      state: targetState as any,
      agentId: targetAgentId, // Pass our identity in context
    } as any)) {
      if (
        chunk.type === "agent:output" ||
        chunk.type === "agent:output-delta"
      ) {
        const summary = summarizeAgentEventValue(chunk);
        if (summary) lastOutput = summary;
      }

      const outMeta = {
        ...chunk.meta,
        ...(threadId ? { threadId } : {}),
        // Always attach the resolved runtime identity when available.
        // This keeps channel-manager responses labeled with the actual manager
        // instead of falling back to the default app name in the UI.
        ...(targetAgentId ? { agentName: targetAgentId } : {}),
      };

      // Suspend still carries nested UI for Melony; emit the same block as a top-level `ui` so SDUI consumers (e.g. AttentionRail) stay consistent.
      if (chunk.type === "suspend") {
        const nested = (chunk as any).data?.event;
        if (nested?.type === "ui" && nested.data?.placement === "attention") {
          yield { ...nested, meta: { ...nested.meta, ...outMeta } } as ConversationEvent;
        }
      }

      yield {
        ...chunk,
        meta: outMeta,
      } as ConversationEvent;
    }

    if (!isTargetingLead && !state.title && lastOutput) {
      const titleRuntime = targetAgentId
        ? agentRuntimes.get(targetAgentId)
        : undefined;

      if (titleRuntime) {
        const genState = state.agentStates[targetAgentId!] ||= {};

        for await (const _ of titleRuntime.run(
          {
            type: "agent:output",
            meta: { agentName: targetAgentId },
            data: { content: lastOutput },
          } as ConversationEvent,
          {
            runId: context.runId,
            state: genState as any,
            agentId: targetAgentId,
          } as any,
        )) {
          // side-effects only (topic agent)
        }
      }
    }
  }
}
