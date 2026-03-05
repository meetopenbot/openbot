import { generateId, MelonyBuilder, Runtime } from "melony";
import { ChatEvent, ChatState } from "../types.js";

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

export function setupDelegation(
  builder: MelonyBuilder<ChatState, ChatEvent>,
  agentRuntimes: Map<string, Runtime<ChatState, ChatEvent>>
) {
  builder.on("action:updateState", async function* (event: ChatEvent, context: { runId: string; state: ChatState }) {
    const { path, value, toolCallId } = event.data;
    const state = context.state as any;

    try {
      setByPath(state, path, value);
      
      // Emit a state update event for the client
      // We can send the whole top-level key that was modified
      const topLevelKey = path.split(".")[0];
      yield {
        type: "state:update",
        data: { key: topLevelKey, value: state[topLevelKey] },
      } as ChatEvent;

      yield {
        type: "action:result",
        data: {
          action: "updateState",
          result: `Successfully updated state at path "${path}".`,
          toolCallId,
        },
      } as ChatEvent;
    } catch (error: any) {
      yield {
        type: "action:result",
        data: {
          action: "updateState",
          result: `Error updating state: ${error.message}`,
          toolCallId,
        },
      } as ChatEvent;
    }
  });

  builder.on("action:delegateTask", async function* (event: ChatEvent, context: { runId: string; state: ChatState }) {
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
    } as ChatEvent;

    // Initialize agent isolated state if not present
    const state = context.state as ChatState;
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

    try {
      for await (const agentEvent of agentIterator) {
        // Forward agent events to the main runtime so the user sees progress.
        // We SKIP forwarding 'agent:input' because it triggers the manager's LLM again.
        // Instead, we yield it as 'agent:sub-input' for logging/monitoring.
        if (agentEvent.type === "agent:input") {
          yield {
            ...agentEvent,
            type: "agent:sub-input",
            meta: { ...agentEvent.meta, delegationId, agentName },
          } as ChatEvent;
          continue;
        }

        // We wrap sub-agent actions to avoid triggering manager handlers if they share names.
        if (agentEvent.type.startsWith("action:") && agentEvent.type !== "action:result") {
          yield {
            ...agentEvent,
            type: "agent:sub-action",
            meta: { ...agentEvent.meta, delegationId, agentName },
            data: { ...agentEvent.data, originalType: agentEvent.type },
          } as ChatEvent;
          continue;
        }

        // Wrap action results to avoid confusion with manager action results.
        if (agentEvent.type === "action:result") {
          yield {
            ...agentEvent,
            type: "agent:sub-action-result",
            meta: { ...agentEvent.meta, delegationId, agentName },
          } as ChatEvent;
          continue;
        }

        // Wrap usage updates to avoid confusion with manager usage.
        if (agentEvent.type === "usage:update") {
          yield {
            ...agentEvent,
            type: "agent:sub-usage",
            meta: { ...agentEvent.meta, delegationId, agentName },
          } as ChatEvent;
          continue;
        }

        // Pass through other events but tag them with delegationId and agentName in meta
        yield {
          ...agentEvent,
          meta: { ...agentEvent.meta, delegationId, agentName },
        } as ChatEvent;

        // accumulate agent output
        if (agentEvent.type === "agent:output") {
          const agentOutput = agentEvent.data as any;

          // DETERMINISTIC SYNC: If agent returns structured data and stateKey is provided
          const value = agentOutput?.result ?? agentOutput?.content ?? agentOutput?.message ?? agentOutput;

          if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            if (stateKey) {
              context.state[stateKey] = value;
              // Emit a state update event for the client
              yield {
                type: "state:update",
                data: { key: stateKey, value },
              } as ChatEvent;
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

    // Signal delegation end for UI
    yield {
      type: "delegation:end",
      meta: { delegationId, agentName },
      data: { agent: agentName, result: lastAgentOutput || "Task completed." },
    } as ChatEvent;

    // Feedback the result back to the manager
    yield {
      type: "action:result",
      data: {
        action: "delegateTask",
        result: lastAgentOutput || "Task completed with no output.",
        toolCallId,
      },
    } as ChatEvent;
  });
}
