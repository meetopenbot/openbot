import { Runtime } from "melony";
import { ManagerEvent, ManagerState } from "../types.js";

function summarizeAgentEventValue(event: any): string | undefined {
  if (!event) return undefined;
  const value = event?.data?.result ?? event?.data?.content ?? event?.data?.message ?? event?.data;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) return JSON.stringify(value, null, 2);
  return undefined;
}

export async function* runOpenBot(
  event: ManagerEvent,
  context: { runId: string; state: ManagerState },
  managerRuntime: Runtime<ManagerState, ManagerEvent>,
  agentRuntimes: Map<string, Runtime<ManagerState, ManagerEvent>>,
  registry: import("../registry/index.js").PluginRegistry
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

    // A. Explicit @mention takes precedence
    if (content?.trim().startsWith("@")) {
      const trimmedContent = content.trim();
      const afterAt = trimmedContent.slice(1);
      let bestMatch: { id: string; name: string; prefixLength: number } | undefined;

      for (const agent of allAgents) {
        const idMatches = afterAt.toLowerCase().startsWith(agent.id.toLowerCase());
        const nameMatches = afterAt.toLowerCase().startsWith(agent.name.toLowerCase());
        if (idMatches || nameMatches) {
          const matchPrefix = idMatches ? agent.id : agent.name;
          const prefixLength = matchPrefix.length;
          const nextChar = afterAt[prefixLength];
          if (!nextChar || nextChar === " ") {
            if (!bestMatch || prefixLength > bestMatch.prefixLength) {
              bestMatch = { id: agent.id, name: agent.name, prefixLength };
            }
          }
        }
      }

      if (bestMatch) {
        targetAgentId = bestMatch.id;
        // Strip the @mention from the content for the agent
        const remaining = afterAt.slice(bestMatch.prefixLength).trim();
        event.data = { ...event.data, content: remaining || "Hello" } as any;
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

    // D. Channel Manager Context
    if (!targetAgentId && conversationId.startsWith("channel_") && state.channelManagerId) {
      if (state.channelManagerId !== "you") {
        targetAgentId = state.channelManagerId;
      }
    }
  }

  // --- 2. EXECUTION: Run the target agent (or manager) ---
  const runtime = targetAgentId ? agentRuntimes.get(targetAgentId) : managerRuntime;
  const isTargetingManager = !targetAgentId || runtime === managerRuntime;

  // For non-input events with an explicit agentName, always try that agent first
  if (event.type !== "agent:input" && event.meta?.agentName) {
    const explicitRuntime = agentRuntimes.get(event.meta.agentName);
    if (explicitRuntime) {
      const target = event.meta.agentName;
      if (!state.agentStates[target]) state.agentStates[target] = {};

      let resumedOutput = "";
      for await (const agentChunk of explicitRuntime.run(event, {
        runId: context.runId,
        state: state.agentStates[target] as any,
      })) {
        yield {
          ...agentChunk,
          meta: {
            ...(agentChunk as any)?.meta,
            ...(event.meta?.delegationId ? { delegationId: event.meta.delegationId } : {}),
            ...(threadId ? { threadId } : {}),
            agentName: target,
          },
        } as ManagerEvent;

        if (agentChunk.type === "agent:output" || agentChunk.type === "action:result") {
          const summary = summarizeAgentEventValue(agentChunk);
          if (summary) {
            if (resumedOutput) resumedOutput += "\n\n";
            resumedOutput += summary;
          }
        }
      }

      // Handle approval/deny resolution for tool-calling agents
      const maybeApprovalId = (event as any)?.data?.id;
      if ((event.type === "action:approve" || event.type === "action:deny") && maybeApprovalId) {
        const pending = state.pendingAgentTasks?.[maybeApprovalId];
        if (pending) {
          const wasDenied = event.type === "action:deny";
          const delegateResult = wasDenied ? { error: "Action denied", denied: true } : (resumedOutput || "Done");
          delete state.pendingAgentTasks![maybeApprovalId];

          yield {
            type: "delegation:end",
            meta: { delegationId: pending.delegationId, agentName: pending.agentName },
            data: { agent: pending.agentName, result: wasDenied ? "Denied" : "Completed" },
          } as ManagerEvent;

          yield* managerRuntime.run({
            type: "action:result",
            data: { action: "delegateTask", result: delegateResult, toolCallId: pending.toolCallId, success: !wasDenied, halt: wasDenied },
          } as ManagerEvent, { runId: context.runId, state: state as any });
        }
      }
      return;
    }
  }

  // Run the resolved runtime
  if (runtime) {
    const targetState = isTargetingManager ? state : (state.agentStates[targetAgentId!] ||= {});
    let lastOutput = "";

    for await (const chunk of runtime.run(event, {
      runId: context.runId,
      state: targetState as any,
    })) {
      if (chunk.type === "agent:output" || chunk.type === "agent:output-delta") {
        const summary = summarizeAgentEventValue(chunk);
        if (summary) lastOutput = summary;
      }

      yield {
        ...chunk,
        meta: {
          ...chunk.meta,
          ...(threadId ? { threadId } : {}),
          ...(targetAgentId && !isTargetingManager ? { agentName: targetAgentId } : {}),
        },
      } as ManagerEvent;
    }

    // Auto-generate title if targeting an agent directly and title is missing
    if (!isTargetingManager && !state.title && lastOutput) {
      for await (const _ of managerRuntime.run({
        type: "agent:output",
        meta: { agentName: targetAgentId },
        data: { content: lastOutput },
      } as ManagerEvent, { runId: context.runId, state: state as any })) {
        // side-effects only (topic agent)
      }
    }
  }
}
