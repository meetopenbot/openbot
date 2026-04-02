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

    // A. Explicit @mention takes precedence
    if (content?.trim().startsWith("@")) {
      const trimmedContent = content.trim();
      const afterAt = trimmedContent.slice(1);
      let bestMatch:
        | { id: string; name: string; prefixLength: number }
        | undefined;

      for (const agent of allAgents) {
        const idMatches = afterAt
          .toLowerCase()
          .startsWith(agent.id.toLowerCase());
        const nameMatches = afterAt
          .toLowerCase()
          .startsWith(agent.name.toLowerCase());
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
    if (
      !targetAgentId &&
      conversationId.startsWith("channel_") &&
      state.channelManagerId
    ) {
      if (state.channelManagerId !== "you") {
        targetAgentId = state.channelManagerId;
      }
    }
  }

  // Determine if the target is the "Lead" of the conversation
  // The lead uses the top-level state instead of isolated agent state.
  const isTargetingLead =
    !targetAgentId ||
    targetAgentId === state.channelManagerId ||
    targetAgentId === "you";

  // --- 2. EXECUTION: Run the target agent ---
  const runtime = targetAgentId ? agentRuntimes.get(targetAgentId) : undefined;

  // For non-input events with an explicit agentName, always try that agent first
  if (event.type !== "agent:input" && event.meta?.agentName) {
    const explicitRuntime = agentRuntimes.get(event.meta.agentName);
    if (explicitRuntime) {
      const target = event.meta.agentName;
      const isLead = target === state.channelManagerId || target === "you";
      const targetState = isLead ? state : (state.agentStates[target] ||= {});

      let resumedOutput = "";
      for await (const agentChunk of explicitRuntime.run(event, {
        runId: context.runId,
        state: targetState as any,
        agentId: target, // Pass our identity in context
      } as any)) {
        yield {
          ...agentChunk,
          meta: {
            ...(agentChunk as any)?.meta,
            ...(event.meta?.delegationId
              ? { delegationId: event.meta.delegationId }
              : {}),
            ...(threadId ? { threadId } : {}),
            agentName: target,
          },
        } as ConversationEvent;

        if (
          agentChunk.type === "agent:output" ||
          agentChunk.type === "action:result"
        ) {
          const summary = summarizeAgentEventValue(agentChunk);
          if (summary) {
            if (resumedOutput) resumedOutput += "\n\n";
            resumedOutput += summary;
          }
        }
      }

      // Handle approval/deny resolution for tool-calling agents
      const maybeApprovalId = (event as any)?.data?.id;
      if (
        (event.type === "action:approve" || event.type === "action:deny") &&
        maybeApprovalId
      ) {
        const pending = state.pendingAgentTasks?.[maybeApprovalId];
        if (pending) {
          const wasDenied = event.type === "action:deny";
          const delegateResult = wasDenied
            ? { error: "Action denied", denied: true }
            : resumedOutput || "Done";
          delete state.pendingAgentTasks![maybeApprovalId];

          yield {
            type: "delegation:end",
            meta: {
              delegationId: pending.delegationId,
              agentName: pending.agentName,
            },
            data: {
              agent: pending.agentName,
              result: wasDenied ? "Denied" : "Completed",
            },
          } as ConversationEvent;

          // Resume the delegator
          const delegatorId = (pending as any).delegatorAgentId;
          const delegatorRuntime = delegatorId
            ? agentRuntimes.get(delegatorId)
            : undefined;

          if (delegatorRuntime) {
            const isDelegatorLead =
              delegatorId === state.channelManagerId || delegatorId === "you";
            const delegatorState = isDelegatorLead
              ? state
              : (state.agentStates[delegatorId] ||= {});

            yield* delegatorRuntime.run(
              {
                type: "action:result",
                data: {
                  action: "delegateTask",
                  result: delegateResult,
                  toolCallId: pending.toolCallId,
                  success: !wasDenied,
                  halt: wasDenied,
                },
              } as ConversationEvent,
              {
                runId: context.runId,
                state: delegatorState as any,
                agentId: delegatorId,
              } as any,
            );
          }
        }
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

    // Auto-generate title if targeting an agent directly and title is missing
    if (!isTargetingLead && !state.title && lastOutput) {
      // We can use the designated manager (if any) or a default agent to generate the title
      const titleGeneratorId =
        state.channelManagerId && state.channelManagerId !== "you"
          ? state.channelManagerId
          : targetAgentId;
      const titleGeneratorRuntime = titleGeneratorId
        ? agentRuntimes.get(titleGeneratorId)
        : undefined;

      if (titleGeneratorRuntime) {
        const isGenLead =
          titleGeneratorId === state.channelManagerId ||
          titleGeneratorId === "you";
        const genState = isGenLead
          ? state
          : (state.agentStates[titleGeneratorId!] ||= {});

        for await (const _ of titleGeneratorRuntime.run(
          {
            type: "agent:output",
            meta: { agentName: targetAgentId },
            data: { content: lastOutput },
          } as ConversationEvent,
          {
            runId: context.runId,
            state: genState as any,
            agentId: titleGeneratorId,
          } as any,
        )) {
          // side-effects only (topic agent)
        }
      }
    }
  }
}
