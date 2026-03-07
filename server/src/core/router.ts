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
  agentRuntimes: Map<string, Runtime<ManagerState, ManagerEvent>>
) {
  const { state } = context;

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
          yield agentChunk;

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

  // 2. Direct agent routing for user input (e.g. "@os list files")
  if (event.type === "agent:input") {
    const content = (event.data as any).content as string;
    if (content?.startsWith("@")) {
      const match = content.match(/^@([a-zA-Z0-9_-]+)\s*(.*)$/);
      if (match) {
        const [, agentName, remaining] = match;
        const runtime = agentRuntimes.get(agentName);

        if (runtime) {
          if (!state.agentStates[agentName]) state.agentStates[agentName] = {};

          const agentEvent = {
            ...event,
            data: {
              content: remaining || "Hello",
              attachments: (event.data as any).attachments,
            },
          } as any;

          for await (const agentChunk of runtime.run(agentEvent, {
            runId: context.runId,
            state: state.agentStates[agentName] as any,
          })) {
            yield {
              ...agentChunk,
              meta: {
                ...(agentChunk as any)?.meta,
                agentName,
              },
            } as ManagerEvent;
          }
          return;
        }
      }
    }
  }

  // 3. Default routing: translate user input to manager input
  yield* managerRuntime.run({ ...event, type: "agent:input" } as ManagerEvent, {
    runId: context.runId,
    state: state as any,
  });
}
