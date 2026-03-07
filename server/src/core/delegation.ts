import { generateId, MelonyBuilder, Runtime } from "melony";
import { ManagerEvent, ManagerState } from "../types.js";
import { uiEvent } from "../ui/block.js";
import { widgets } from "../ui/widgets/index.js";

/**
 * Simple helper to set a value in an object by a dot-separated path.
 */
function setByPath(obj: any, path: string, value: any) {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Helper to emit a UI snapshot for a widget if applicable.
 */
function* maybeEmitWidget(key: string, value: any) {
  if (!value || typeof value !== "object") return;

  let widgetName = value.widget;
  let data = value;

  // 1. Check for nested .todos array (common pattern for planner/task agents)
  if (!widgetName && Array.isArray(value.todos)) {
    widgetName = "todoList";
    data = value.todos;
  }

  // 2. Fallback for direct arrays if key matches known patterns
  if (!widgetName && Array.isArray(value) && ["todos", "todoList", "project_plan"].includes(key)) {
    widgetName = "todoList";
    data = value;
  }

  // If we found a valid widget and data is an array, emit the UI event
  if (widgetName && (widgets as any)[widgetName] && Array.isArray(data)) {
    const isTodo = widgetName === "todoList";
    yield uiEvent((widgets as any)[widgetName](data, {
      placement: isTodo ? "attention" : "sidebar",
      id: isTodo ? `attention-${key}` : `sidebar-${key}`,
      meta: { title: key === "project_plan" ? "Project Plan" : (key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')) }
    })) as any;
  }
}

export function setupDelegation(
  builder: MelonyBuilder<ManagerState, ManagerEvent>,
  agentRuntimes: Map<string, Runtime<ManagerState, ManagerEvent>>
) {
  builder.on("action:updateSessionState", async function* (event: ManagerEvent, context: { runId: string; state: ManagerState }) {
    const { path, value, toolCallId } = event.data;
    const state = context.state as any;

    try {
      setByPath(state, path, value);
      
      const topLevelKey = path.split(".")[0];
      yield* maybeEmitWidget(topLevelKey, state[topLevelKey]);

      yield {
        type: "action:result",
        data: {
          action: "updateSessionState",
          result: `Successfully updated state at path "${path}".`,
          toolCallId,
        },
      } as ManagerEvent;
    } catch (error: any) {
      yield {
        type: "action:result",
        data: {
          action: "updateSessionState",
          result: `Error updating state: ${error.message}`,
          toolCallId,
        },
      } as ManagerEvent;
    }
  });

  builder.on("action:delegateTask", async function* (event: ManagerEvent, context: { runId: string; state: ManagerState }) {
    const { agent: agentName, toolCallId, task, stateKey, attachments } = event.data;
    const agentRuntime = agentRuntimes.get(agentName);

    // If the agent is not found, return an error
    if (!agentRuntime) {
      yield {
        type: "action:result",
        data: {
          action: "delegateTask",
          result: `Error: Agent "${agentName}" not found.`,
          toolCallId,
        },
      };
      return;
    }

    const delegationId = `del_${generateId()}`;

    // Signal delegation start for UI
    yield {
      type: "delegation:start",
      meta: { delegationId, agentName },
      data: { agent: agentName, task },
    } as ManagerEvent;

    // Initialize agent isolated state if not present
    const state = context.state as ManagerState;
    if (!state.agentStates) state.agentStates = {};
    if (!state.agentStates[agentName]) state.agentStates[agentName] = {};

    const agentState = state.agentStates[agentName];

    const agentIterator = agentRuntime.run(
      {
        type: "agent:input",
        data: { content: task, attachments },
      } as any,
      {
        runId: delegationId,
        state: agentState as any,
      }
    );

    let lastAgentOutput = "";
    let pendingApprovalId: string | undefined;

    try {
      for await (const agentEvent of agentIterator) {
        // Dedicated suspend event from approval plugin.
        // Emit included UI event (if any), then park this delegation until approve/deny.
        if (agentEvent.type === "suspend") {
          const suspendData = (agentEvent as any).data ?? {};
          const suspendId = typeof suspendData.id === "string" ? suspendData.id : undefined;
          const suspendUiEvent = suspendData.event;

          if (suspendUiEvent && typeof suspendUiEvent === "object" && typeof suspendUiEvent.type === "string") {
            yield {
              ...suspendUiEvent,
              meta: { ...suspendUiEvent.meta, delegationId, agentName },
            } as ManagerEvent;
          }

          if (suspendId) {
            pendingApprovalId = suspendId;
          }
          continue;
        }

        // Forward agent events to the main runtime so the user sees progress.
        // We SKIP forwarding 'agent:input' because it triggers the manager's LLM again.
        // Instead, we yield it as 'agent:sub-input' for logging/monitoring.
        if (agentEvent.type === "agent:input") {
          yield {
            ...agentEvent,
            type: "agent:sub-input",
            meta: { ...agentEvent.meta, delegationId, agentName },
          } as ManagerEvent;
          continue;
        }

        // We wrap sub-agent actions to avoid triggering manager handlers if they share names.
        if (agentEvent.type.startsWith("action:") && agentEvent.type !== "action:result") {
          yield {
            ...agentEvent,
            type: "agent:sub-action",
            meta: { ...agentEvent.meta, delegationId, agentName },
            data: { ...agentEvent.data, originalType: agentEvent.type },
          } as ManagerEvent;
          continue;
        }

        // Wrap action results to avoid confusion with manager action results.
        if (agentEvent.type === "action:result") {
          yield {
            ...agentEvent,
            type: "agent:sub-action-result",
            meta: { ...agentEvent.meta, delegationId, agentName },
          } as ManagerEvent;
          continue;
        }

        // Wrap usage updates to avoid confusion with manager usage.
        if (agentEvent.type === "usage:update") {
          yield {
            ...agentEvent,
            type: "agent:sub-usage",
            meta: { ...agentEvent.meta, delegationId, agentName },
          } as ManagerEvent;
          continue;
        }

        // Pass through other events but tag them with delegationId and agentName in meta
        yield {
          ...agentEvent,
          meta: { ...agentEvent.meta, delegationId, agentName },
        } as ManagerEvent;

        // accumulate agent output
        if (agentEvent.type === "agent:output") {
          const agentOutput = agentEvent.data as any;

          // DETERMINISTIC SYNC: If agent returns structured data and stateKey is provided
          const value = agentOutput?.result ?? agentOutput?.content ?? agentOutput?.message ?? agentOutput;

          if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            if (stateKey) {
              context.state[stateKey] = value;
              yield* maybeEmitWidget(stateKey, value);
            }

            if (lastAgentOutput) lastAgentOutput += "\n\n";
            lastAgentOutput += JSON.stringify(value, null, 2);
          } else if (typeof value === "string") {
            if (lastAgentOutput) lastAgentOutput += "\n\n";
            lastAgentOutput += value;
          }
        }
      }
    } catch (error: any) {
      console.error(`[delegation] Error running agent "${agentName}":`, error);
      lastAgentOutput = `Error executing task: ${error.message}`;
    }

    // Option A behavior: if sub-agent suspended on approval,
    // keep the manager tool call pending until approve/deny follow-up resolves it.
    if (pendingApprovalId) {
      state.pendingAgentTasks ??= {};
      state.pendingAgentTasks[pendingApprovalId] = {
        toolCallId,
        agentName,
        delegationId,
        stateKey: typeof stateKey === "string" ? stateKey : undefined,
      };
      return;
    }

    // Signal delegation end for UI
    yield {
      type: "delegation:end",
      meta: { delegationId, agentName },
      data: { agent: agentName, result: lastAgentOutput || "Task completed." },
    } as ManagerEvent;

    // Feedback the result back to the manager
    yield {
      type: "action:result",
      data: {
        action: "delegateTask",
        result: lastAgentOutput || "Task completed with no output.",
        toolCallId,
      },
    } as ManagerEvent;
  });
}
