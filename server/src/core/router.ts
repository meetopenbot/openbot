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

  const allAgents = registry.getAgents();

  // Initialize state
  if (!state.messages) state.messages = [];
  if (!state.agentStates) state.agentStates = {};

  // 1. Route non-user events directly (pluggable).
  //    If an event is tagged with meta.agentName, send it to that agent runtime.
  //    Otherwise, pass it to manager runtime unchanged.
  if (event.type !== "agent:input") {
    const targetAgent = event.meta?.agentName;
    if (targetAgent) {
      const runtime = agentRuntimes.get(targetAgent);
      if (runtime) {
        if (!state.agentStates[targetAgent]) state.agentStates[targetAgent] = {};

        let resumedOutput = "";
        for await (const agentChunk of runtime.run(event, {
          runId: context.runId,
          state: state.agentStates[targetAgent] as any,
        })) {
          // Preserve sub-agent attribution when resuming after approval/deny
          // so UI does not fall back to manager identity.
          yield {
            ...agentChunk,
            meta: {
              ...(agentChunk as any)?.meta,
              ...(event.meta?.delegationId ? { delegationId: event.meta.delegationId } : {}),
              agentName: targetAgent,
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

        // Resolve pending delegated tool call after approval follow-up.
        const maybeApprovalId = (event as any)?.data?.id;
        const shouldResolvePending =
          (event.type === "action:approve" || event.type === "action:deny")
          && typeof maybeApprovalId === "string";

        if (shouldResolvePending) {
          const pending = state.pendingAgentTasks?.[maybeApprovalId];
          if (pending) {
            const wasDenied = event.type === "action:deny";
            const delegateResult = wasDenied
              ? { error: "Action denied by user", denied: true }
              : (resumedOutput || "Task completed with no output.");

            delete state.pendingAgentTasks![maybeApprovalId];

            yield {
              type: "delegation:end",
              meta: { delegationId: pending.delegationId, agentName: pending.agentName },
              data: {
                agent: pending.agentName,
                result: wasDenied ? "Action denied by user." : (resumedOutput || "Task completed."),
              },
            } as ManagerEvent;

            yield* managerRuntime.run(
              {
                type: "action:result",
                data: {
                  action: "delegateTask",
                  result: delegateResult,
                  toolCallId: pending.toolCallId,
                  success: !wasDenied,
                  halt: wasDenied,
                },
              } as ManagerEvent,
              {
                runId: context.runId,
                state: state as any,
              }
            );
          }
        }
        return;
      }
    }

    yield* managerRuntime.run(event, {
      runId: context.runId,
      state: state as any,
    });
    return;
  }

  // 2. Direct agent routing for user input (e.g. "@os list files" or "@Codex Agent list files")
  if (event.type === "agent:input") {
    const content = (event.data as any).content as string;
    const explicitTargetAgent = event.meta?.agentName;

    if (explicitTargetAgent) {
      const runtime = agentRuntimes.get(explicitTargetAgent);
      if (runtime) {
        if (!state.agentStates[explicitTargetAgent]) state.agentStates[explicitTargetAgent] = {};

        let lastAgentOutput = "";
        for await (const agentChunk of runtime.run(event, {
          runId: context.runId,
          state: state.agentStates[explicitTargetAgent] as any,
        })) {
          if (agentChunk.type === "agent:output" || agentChunk.type === "agent:output-delta") {
            const summary = summarizeAgentEventValue(agentChunk);
            if (summary) lastAgentOutput = summary;
          }

          yield {
            ...agentChunk,
            meta: {
              ...(agentChunk as any)?.meta,
              agentName: explicitTargetAgent,
            },
          } as ManagerEvent;
        }

        if (!state.title) {
          for await (const _ of managerRuntime.run(
            {
              type: "agent:output",
              meta: { agentName: explicitTargetAgent },
              data: { content: lastAgentOutput || "" },
            } as ManagerEvent,
            {
              runId: context.runId,
              state: state as any,
            }
          )) {
            // side-effects only
          }
        }
        return;
      }
    }

    if (content?.trim().startsWith("@")) {
      const trimmedContent = content.trim();
      const afterAt = trimmedContent.slice(1);

      // Find the longest matching agent (by ID or Name) at the start of the message
      // This handles agent names with spaces like "Codex Agent"
      let bestMatch: { id: string; name: string; prefixLength: number } | undefined;

      for (const agent of allAgents) {
        const idMatches = afterAt.toLowerCase().startsWith(agent.id.toLowerCase());
        const nameMatches = afterAt.toLowerCase().startsWith(agent.name.toLowerCase());

        if (idMatches || nameMatches) {
          const matchPrefix = idMatches ? agent.id : agent.name;
          const prefixLength = matchPrefix.length;
          
          // Next char must be space, end of string, or the match length must be at least 
          // the current best match length (prefer longer names like "Codex Agent" over "Codex")
          const nextChar = afterAt[prefixLength];
          if (!nextChar || nextChar === " ") {
            if (!bestMatch || prefixLength > bestMatch.prefixLength) {
              bestMatch = { id: agent.id, name: agent.name, prefixLength };
            }
          }
        }
      }

      if (bestMatch) {
        const targetAgent = bestMatch.id;
        const remaining = afterAt.slice(bestMatch.prefixLength).trim();

        const runtime = agentRuntimes.get(targetAgent);
        if (runtime) {
          if (!state.agentStates[targetAgent]) state.agentStates[targetAgent] = {};

          const agentEvent = {
            ...event,
            data: {
              content: remaining || "Hello",
              attachments: (event.data as any).attachments,
            },
          } as any;

          let lastAgentOutput = "";
          for await (const agentChunk of runtime.run(agentEvent, {
            runId: context.runId,
            state: state.agentStates[targetAgent] as any,
          })) {
            if (agentChunk.type === "agent:output" || agentChunk.type === "agent:output-delta") {
              const summary = summarizeAgentEventValue(agentChunk);
              if (summary) lastAgentOutput = summary;
            }

            yield {
              ...agentChunk,
              meta: {
                ...(agentChunk as any)?.meta,
                agentName: targetAgent,
              },
            } as ManagerEvent;
          }

          // Direct "@agent" routing bypasses manager handlers entirely.
          // Trigger manager-side post-processing (e.g. topic/title generation)
          // without producing a manager reply.
          if (!state.title) {
            for await (const _ of managerRuntime.run(
              {
                type: "agent:output",
                meta: { agentName: targetAgent },
                data: { content: lastAgentOutput || "" },
              } as ManagerEvent,
              {
                runId: context.runId,
                state: state as any,
              }
            )) {
              // side-effects only
            }
          }
          return;
        }
      } else {
        // If the user used @ but the agent wasn't found, stop here to avoid
        // falling back to the manager and burning tokens for a failed routing attempt.
        const agentPrefixMatch = afterAt.split(" ")[0];
        yield {
          type: "agent:output",
          data: { 
            content: `Agent "@${agentPrefixMatch}" not found. Available agents:\n${allAgents.map(a => `- ${a.name} (@${a.id})`).join("\n")}` 
          },
        } as ManagerEvent;
        return;
      }
    }
  }

  // 3. Default routing: translate user input to manager input
  yield* managerRuntime.run({ ...event, type: "agent:input" } as ManagerEvent, {
    runId: context.runId,
    state: state as any,
  });
}
