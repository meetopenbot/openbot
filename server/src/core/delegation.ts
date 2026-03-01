import { generateId, Runtime } from "melony";
import { ChatEvent, ChatState } from "../types.js";

export function setupDelegation(
  builder: any,
  agentRuntimes: Map<string, Runtime<ChatState, ChatEvent>>
) {
  builder.on("action:delegateTask", async function* (event: any, context: any) {
    const { agent: agentName, task, attachments } = event.data;
    const agentRuntime = agentRuntimes.get(agentName);

    if (!agentRuntime) {
      yield {
        type: "action:result",
        data: {
          action: "delegateTask",
          result: `Error: Agent "${agentName}" not found.`,
          toolCallId: event.data.toolCallId,
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
          if (typeof agentOutput === "string") {
            if (lastAgentOutput) lastAgentOutput += "\n\n";
            lastAgentOutput += agentOutput;
          } else if (typeof agentOutput === "object") {
            if (lastAgentOutput) lastAgentOutput += "\n\n";
            lastAgentOutput += JSON.stringify(agentOutput);
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
        toolCallId: event.data.toolCallId,
      },
    } as ChatEvent;
  });
}
