import { melony, MelonyPlugin, Runtime } from "melony";
import { ChatEvent, ChatState, AgentState } from "./types.js";

const AGENT_TEXT_TYPES = new Set(["assistant:text-delta", "assistant:text"]);

function isAgentTextEvent(event: { type: string }): boolean {
  return AGENT_TEXT_TYPES.has(event.type);
}

export interface OrchestratorAgent {
  name: string;
  description: string;
  plugin: MelonyPlugin<any, any>;
  capabilities?: Record<string, string>;
}

export interface OrchestratorOptions {
  managerPlugin: MelonyPlugin<ChatState, ChatEvent>;
  agents: OrchestratorAgent[];
}

/**
 * Orchestrator coordinates isolated runtimes for the manager and each agent.
 *
 * Instead of composing all plugins into a single shared runtime (which causes
 * duplicate handlers and shared state bugs), each agent gets its own melony
 * runtime. The orchestrator routes events between them.
 */
export class Orchestrator {
  private managerPlugin: MelonyPlugin<ChatState, ChatEvent>;
  private agents: Map<string, OrchestratorAgent>;

  constructor(options: OrchestratorOptions) {
    this.managerPlugin = options.managerPlugin;
    this.agents = new Map(options.agents.map((a) => [a.name, a]));
  }

  private buildManagerRuntime(): Runtime<any, any> {
    const builder = melony();
    builder.use(this.managerPlugin as MelonyPlugin<any, any>);
    builder.on("action:taskResult", async function* (event: any) {
      yield { type: "manager:result", data: event.data };
    });
    return builder.build();
  }

  private buildAgentRuntime(agent: OrchestratorAgent): Runtime<any, any> {
    const builder = melony();
    builder.use(agent.plugin);
    const name = agent.name;
    builder.on("action:taskResult", async function* (event: any) {
      yield { type: `agent:${name}:result`, data: event.data };
    });
    return builder.build();
  }

  private getAgentState(agentName: string, sessionState: ChatState): AgentState {
    if (!sessionState.agentStates) sessionState.agentStates = {};
    if (!sessionState.agentStates[agentName]) {
      sessionState.agentStates[agentName] = {};
    }
    const agentState = sessionState.agentStates[agentName];
    if (!agentState.cwd) agentState.cwd = sessionState.cwd;
    return agentState;
  }

  async *run(
    event: ChatEvent,
    options: { runId?: string; state: ChatState }
  ): AsyncGenerator<ChatEvent> {
    const { state, runId = `run_${Date.now()}` } = options;

    // Yield the input event so it gets logged and the client can render it
    yield event;

    if (event.type === "action:approve" || event.type === "action:deny") {
      yield* this.routeApproval(event, state, runId);
      return;
    }

    if (event.type === "user:text") {
      const content = (event.data as any).content?.trim() || "";

      if (content.startsWith("/") || content.startsWith("@")) {
        const firstSpace = content.indexOf(" ");
        const prefix =
          firstSpace === -1 ? content.slice(1) : content.slice(1, firstSpace);
        const task =
          firstSpace === -1 ? "" : content.slice(firstSpace + 1).trim();

        if (this.agents.has(prefix)) {
          state.lastDirectAgent = prefix;
          yield* this.runAgentDirect(prefix, task, state, runId);
          return;
        }
      }

      state.lastDirectAgent = undefined;
      yield* this.runManagerLoop(
        { type: "manager:input", data: event.data } as ChatEvent,
        state,
        runId
      );
      return;
    }

    yield* this.runManagerLoop(event, state, runId);
  }

  /**
   * Runs the manager runtime. When it yields `action:delegateTask`,
   * the orchestrator intercepts, runs the target agent to completion,
   * then feeds the result back to the manager in a new run.
   */
  private async *runManagerLoop(
    event: ChatEvent,
    state: ChatState,
    runId: string
  ): AsyncGenerator<ChatEvent> {
    const runtime = this.buildManagerRuntime();

    for await (const yielded of runtime.run(event, { state, runId })) {
      if (yielded.type === "action:delegateTask") {
        const { agent: agentName, task, toolCallId } = (yielded as any).data;

        if (!this.agents.has(agentName)) {
          yield* this.runManagerLoop(
            {
              type: "manager:result",
              data: {
                action: "delegateTask",
                toolCallId,
                result: `Error: Agent "${agentName}" not found`,
              },
            } as ChatEvent,
            state,
            runId
          );
          return;
        }

        if (!state.pendingAgentTasks) state.pendingAgentTasks = {};
        state.pendingAgentTasks[agentName] = { toolCallId };

        let agentOutput = "";
        let agentCompleted = false;

        try {
          for await (const agentEvent of this.runAgentInternal(
            agentName,
            task,
            state,
            runId
          )) {
            if (agentEvent.type === `agent:${agentName}:output`) {
              agentOutput = (agentEvent as any).data.content;
              agentCompleted = true;
            }
            // During delegation, suppress the agent's LLM text — the manager
            // will summarize the result for the user. Still pass through
            // operational events (status, UI/approval cards, etc.).
            if (!isAgentTextEvent(agentEvent)) {
              yield agentEvent;
            }
          }
        } catch (error) {
          agentOutput = `Error: ${error instanceof Error ? error.message : String(error)}`;
          agentCompleted = true;
        }

        if (agentCompleted) {
          delete state.pendingAgentTasks![agentName];

          yield* this.runManagerLoop(
            {
              type: "manager:result",
              data: {
                action: "delegateTask",
                toolCallId,
                result: agentOutput,
              },
            } as ChatEvent,
            state,
            runId
          );
        }
        return;
      }

      yield yielded;
    }
  }

  private async *runAgentInternal(
    agentName: string,
    task: string,
    sessionState: ChatState,
    runId: string
  ): AsyncGenerator<ChatEvent> {
    const agent = this.agents.get(agentName)!;
    const agentState = this.getAgentState(agentName, sessionState);
    const runtime = this.buildAgentRuntime(agent);

    const inputEvent = {
      type: `agent:${agentName}:input`,
      data: { content: task },
    } as ChatEvent;

    for await (const yielded of runtime.run(inputEvent, {
      state: agentState,
      runId,
    })) {
      yield yielded as ChatEvent;
    }
  }

  /**
   * Direct agent invocation via prefix commands (/agent task).
   * Wraps the agent's output event as assistant:text for the client.
   */
  private async *runAgentDirect(
    agentName: string,
    task: string,
    sessionState: ChatState,
    runId: string
  ): AsyncGenerator<ChatEvent> {
    for await (const yielded of this.runAgentInternal(
      agentName,
      task,
      sessionState,
      runId
    )) {
      if (yielded.type === `agent:${agentName}:output`) {
        yield {
          type: "assistant:text",
          data: { content: (yielded as any).data.content },
          meta: { agent: agentName },
        } as any;
      } else {
        yield yielded;
      }
    }
  }

  /**
   * Routes approval/deny events to the agent that owns the pending approval.
   * After the agent resumes, bridges back to the manager if this was a delegation.
   */
  private async *routeApproval(
    event: ChatEvent,
    state: ChatState,
    runId: string
  ): AsyncGenerator<ChatEvent> {
    const approvalId = (event.data as any).id;
    const agentStates = state.agentStates || {};
    let targetAgent: string | undefined;

    for (const [name, agentState] of Object.entries(agentStates)) {
      if (agentState.pendingApprovals?.[approvalId]) {
        targetAgent = name;
        break;
      }
    }

    if (!targetAgent) {
      console.warn("[orchestrator] No agent found for approval event:", approvalId);
      return;
    }

    const agent = this.agents.get(targetAgent)!;
    const agentState = this.getAgentState(targetAgent, state);
    const runtime = this.buildAgentRuntime(agent);

    let agentOutput = "";
    let agentCompleted = false;

    const isDelegation = !!state.pendingAgentTasks?.[targetAgent];

    for await (const yielded of runtime.run(event as any, {
      state: agentState,
      runId,
    })) {
      if (yielded.type === `agent:${targetAgent}:output`) {
        agentOutput = (yielded as any).data.content;
        agentCompleted = true;
      }
      if (isDelegation && isAgentTextEvent(yielded)) {
        continue;
      }
      yield yielded as ChatEvent;
    }

    if (agentCompleted && state.pendingAgentTasks?.[targetAgent]) {
      const { toolCallId } = state.pendingAgentTasks[targetAgent];
      delete state.pendingAgentTasks![targetAgent];

      yield* this.runManagerLoop(
        {
          type: "manager:result",
          data: {
            action: "delegateTask",
            toolCallId,
            result: agentOutput,
          },
        } as ChatEvent,
        state,
        runId
      );
    } else if (agentCompleted && state.lastDirectAgent === targetAgent) {
      yield {
        type: "assistant:text",
        data: { content: agentOutput },
        meta: { agent: targetAgent },
      } as any;
    }
  }
}
