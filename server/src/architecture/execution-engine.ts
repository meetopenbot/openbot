import type { AttachmentRef, ChatEvent, ChatState } from "../types.js";
import type { ExecutionTrace, Plan, PlanStep } from "./contracts.js";

export interface ExecuteCallbacks {
  runManager(
    content: string,
    attachments: AttachmentRef[] | undefined,
    state: ChatState,
    runId: string
  ): AsyncGenerator<ChatEvent>;
  runAgent(
    agentName: string,
    task: string,
    attachments: AttachmentRef[] | undefined,
    state: ChatState,
    runId: string
  ): AsyncGenerator<ChatEvent>;
}

export interface ExecutePlanInput {
  plan: Plan;
  state: ChatState;
  runId: string;
  traceId: string;
  callbacks: ExecuteCallbacks;
  policy?: Partial<ExecutionPolicy>;
}

export interface ExecutionPolicy {
  maxRetries: number;
  stepTimeoutMs: number;
}

const DEFAULT_POLICY: ExecutionPolicy = {
  maxRetries: 1,
  stepTimeoutMs: 45_000,
};

function nowIso(): string {
  return new Date().toISOString();
}

function toError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function updateTrace(
  state: ChatState,
  patch: Partial<ExecutionTrace>
): ExecutionTrace {
  const next: ExecutionTrace = {
    traceId: patch.traceId ?? state.execution?.traceId ?? `trace_${Date.now()}`,
    state: patch.state ?? state.execution?.state ?? "RECEIVED",
    intent: patch.intent ?? state.execution?.intent,
    plan: patch.plan ?? state.execution?.plan,
    currentStepId: patch.currentStepId ?? state.execution?.currentStepId,
    error: patch.error ?? state.execution?.error,
    updatedAt: nowIso(),
  };
  state.execution = next;
  return next;
}

function toExecutionEvent(trace: ExecutionTrace): ChatEvent {
  return {
    type: "execution:state",
    data: {
      traceId: trace.traceId,
      state: trace.state,
      currentStepId: trace.currentStepId,
      error: trace.error,
      intentType: trace.intent?.type,
      planSteps: trace.plan?.steps.length,
    },
  } as ChatEvent;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Step timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function hasPendingApprovals(state: ChatState): boolean {
  const agentStates = state.agentStates || {};
  return Object.values(agentStates).some(
    (agentState) =>
      !!agentState.pendingApprovals &&
      Object.keys(agentState.pendingApprovals).length > 0
  );
}

async function* executeStep(
  step: PlanStep,
  input: ExecutePlanInput,
  policy: ExecutionPolicy
): AsyncGenerator<ChatEvent> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      const stream =
        step.kind === "delegate"
          ? input.callbacks.runAgent(
              step.agent ?? "",
              step.task ?? "",
              step.attachments,
              input.state,
              input.runId
            )
          : input.callbacks.runManager(
              step.content ?? "",
              step.attachments,
              input.state,
              input.runId
            );

      while (true) {
        const nextItem = await withTimeout(stream.next(), policy.stepTimeoutMs);
        if (nextItem.done) break;

        const event = nextItem.value as ChatEvent;

        if (input.state.execution?.state === "WAITING_APPROVAL") {
          const trace = updateTrace(input.state, {
            state: "EXECUTING",
            currentStepId: step.id,
          });
          yield toExecutionEvent(trace);
        }

        yield event;
      }

      return;
    } catch (error) {
      lastError = error;
      if (attempt < policy.maxRetries) {
        const trace = updateTrace(input.state, {
          state: "EXECUTING",
          currentStepId: step.id,
          error: `Retry ${attempt + 1}/${policy.maxRetries}: ${toError(error)}`,
        });
        yield toExecutionEvent(trace);
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(toError(lastError));
}

/**
 * Stateful execution engine for plan steps.
 * The engine is the commit point for executing actions from a plan.
 */
export async function* executePlan(
  input: ExecutePlanInput
): AsyncGenerator<ChatEvent> {
  const policy: ExecutionPolicy = {
    ...DEFAULT_POLICY,
    ...(input.policy ?? {}),
  };

  let trace = updateTrace(input.state, {
    traceId: input.traceId,
    state: "EXECUTING",
    plan: input.plan,
    error: undefined,
  });
  yield toExecutionEvent(trace);

  try {
    for (const step of input.plan.steps) {
      trace = updateTrace(input.state, {
        state: "EXECUTING",
        currentStepId: step.id,
        error: undefined,
      });
      yield toExecutionEvent(trace);
      yield* executeStep(step, input, policy);

      if (hasPendingApprovals(input.state)) {
        trace = updateTrace(input.state, {
          state: "WAITING_APPROVAL",
          currentStepId: step.id,
        });
        yield toExecutionEvent(trace);
        return;
      }
    }

    trace = updateTrace(input.state, {
      state: "COMPLETED",
      currentStepId: undefined,
      error: undefined,
    });
    yield toExecutionEvent(trace);
  } catch (error) {
    trace = updateTrace(input.state, {
      state: "FAILED",
      error: toError(error),
    });
    yield toExecutionEvent(trace);
    throw error;
  }
}

export function setExecutionState(
  state: ChatState,
  patch: Partial<ExecutionTrace>
): ExecutionTrace {
  return updateTrace(state, patch);
}

export function executionStateEvent(trace: ExecutionTrace): ChatEvent {
  return toExecutionEvent(trace);
}
