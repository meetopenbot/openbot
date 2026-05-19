import {
  AgentInvokeEvent,
  OpenBotEvent,
  OpenBotState,
  TodoItem,
} from '../app/types.js';
import { ensureEventId } from '../app/utils.js';
import { storageService } from '../services/storage.js';
import { createAgentRuntime } from './runtime-factory.js';

const TODO_RESULT_MAX_CHARS = 12000;

const readThreadState = (state: OpenBotState): Record<string, unknown> =>
  (state.threadDetails?.state as Record<string, unknown> | undefined) ?? {};

const readTodos = (state: OpenBotState): TodoItem[] => {
  const raw = readThreadState(state).todos;
  return Array.isArray(raw) ? (raw as TodoItem[]) : [];
};

function truncateTodoResult(text: string, maxChars = TODO_RESULT_MAX_CHARS): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n…[truncated]`;
}

function resolveTodoIdForWorker(
  todos: TodoItem[],
  workerId: string,
  delegationTodoId?: string,
): string | undefined {
  if (delegationTodoId && todos.some((t) => t.id === delegationTodoId)) {
    return delegationTodoId;
  }
  const inProgress = todos.find(
    (t) => t.status === 'in_progress' && t.assignee === workerId,
  );
  if (inProgress) return inProgress.id;
  const assigned = todos.find(
    (t) =>
      (t.status === 'pending' || t.status === 'in_progress') && t.assignee === workerId,
  );
  return assigned?.id;
}

export async function recordWorkerTodoResult(
  state: OpenBotState,
  workerId: string,
  output: string | undefined,
  delegationTodoId?: string,
): Promise<void> {
  if (!state.threadId) return;
  const result = truncateTodoResult(output ?? '');
  if (!result) return;

  const todos = readTodos(state);
  if (todos.length === 0) return;

  const todoId = resolveTodoIdForWorker(todos, workerId, delegationTodoId);
  if (!todoId) return;

  const prior = todos.find((t) => t.id === todoId);
  if (prior?.result === result) return;

  const now = Date.now();
  const next = todos.map((t) => (t.id === todoId ? { ...t, result, updatedAt: now } : t));

  await storageService.patchThreadState({
    channelId: state.channelId,
    threadId: state.threadId,
    state: { todos: next },
  });
}

export function makeInternalInvoke(content: string, threadId?: string): AgentInvokeEvent {
  return ensureEventId({
    type: 'agent:invoke',
    data: { role: 'user', content },
    meta: { threadId, internal: true },
  } satisfies AgentInvokeEvent) as AgentInvokeEvent;
}

export interface RunAgentTurnOptions {
  runId: string;
  channelId: string;
  threadId?: string;
  agentId: string;
  event: AgentInvokeEvent;
  delegationTodoId?: string;
}

/**
 * Run one agent turn (no dispatcher chaining). Yields all runtime events for
 * persistence/streaming; returns the last non-empty `agent:output` text.
 */
export async function* runAgentTurn(
  options: RunAgentTurnOptions,
): AsyncGenerator<OpenBotEvent, string | undefined> {
  const { runId, channelId, threadId, agentId, event, delegationTodoId } = options;
  const target = { runId, agentId, channelId, threadId };

  let state: OpenBotState;
  try {
    state = await storageService.getOpenBotState({ ...target, event });
  } catch (error) {
    if ((error as Error & { code?: string }).code === 'AGENT_NOT_FOUND') {
      return undefined;
    }
    throw error;
  }

  yield { type: 'agent:run:start', data: { ...target } } as OpenBotEvent;

  let lastAgentOutput: string | undefined;

  try {
    const runtime = await createAgentRuntime(state);
    for await (const chunk of runtime.run(event, { state, runId })) {
      if (chunk.id === event.id && chunk.type === event.type) continue;

      if (
        chunk.type === 'agent:output' &&
        (chunk.meta as { agentId?: string } | undefined)?.agentId === agentId
      ) {
        const content = chunk.data?.content;
        if (typeof content === 'string' && content.trim()) {
          lastAgentOutput = content.trim();
        }
      }

      chunk.meta = { ...chunk.meta, agentId };
      yield chunk;
    }
  } finally {
    const stateAfterRun = await storageService.getOpenBotState({ ...target, event });
    yield { type: 'agent:run:end', data: { ...target } } as OpenBotEvent;
    await recordWorkerTodoResult(stateAfterRun, agentId, lastAgentOutput, delegationTodoId);
  }

  return lastAgentOutput;
}
