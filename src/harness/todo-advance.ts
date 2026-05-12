import { TodoItem, TodoStatus } from '../app/types.js';
import type { Storage } from '../bus/types.js';

/** Stored on each todo and inlined into the next assignee's invoke payload. */
const RESULT_MAX_CHARS = 12000;

/**
 * Shared helpers that drive the autonomous todo loop. The queue processor
 * calls `advanceAfterRun` once per `agent:run:end`; that is the only place
 * todos are completed and dispatched, which keeps the autonomous flow
 * single-threaded and easy to reason about.
 */

export const readTodosFromState = (state: unknown): TodoItem[] => {
  const raw = (state as Record<string, unknown> | undefined)?.todos;
  return Array.isArray(raw) ? (raw as TodoItem[]) : [];
};

export function truncateTodoResult(text: string, maxChars = RESULT_MAX_CHARS): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n…[truncated]`;
}

export interface AdvanceResult {
  /** Updated todo list (after marking finished + flipping next to in_progress). */
  todos: TodoItem[];
  /** Next agent to invoke, if any. */
  handoff: { agentId: string; content: string; todoId: string } | null;
}

/**
 * Apply a single advance step:
 *  1. If a todo is `in_progress` and `assignee` matches the agent whose run
 *     just ended, mark it `done` and attach `result` from `lastOutput` when present.
 *  2. Pick the next `pending` todo with an `assignee` and flip it to
 *     `in_progress`. That assignee gets handed off to; `invoke content` includes
 *     the previous step output when available so agents without short-term
 *     history still see prior work.
 *
 * If a todo is already `in_progress` and the just-ended agent wasn't its
 * assignee, leave it alone — someone else is working.
 */
export function advanceTodos(
  todos: TodoItem[],
  endedAgentId: string,
  lastOutput?: string,
): AdvanceResult {
  const now = Date.now();
  const truncated = truncateTodoResult(lastOutput ?? '');

  let completedOutput: string | undefined;

  let working = todos.map((t) => {
    if (t.status === 'in_progress' && t.assignee === endedAgentId) {
      completedOutput = truncated;
      return {
        ...t,
        status: 'done' as TodoStatus,
        updatedAt: now,
        ...(truncated !== undefined ? { result: truncated } : {}),
      };
    }
    return t;
  });

  if (working.some((t) => t.status === 'in_progress')) {
    return { todos: working, handoff: null };
  }

  const idx = working.findIndex((t) => t.status === 'pending' && t.assignee);
  if (idx === -1) return { todos: working, handoff: null };

  const picked = working[idx];
  working = working.map((t, i) =>
    i === idx ? { ...t, status: 'in_progress' as TodoStatus, updatedAt: now } : t,
  );

  const invokeContent =
    completedOutput !== undefined && completedOutput !== ''
      ? `${picked.content}\n\n--- Output from previous step ---\n${completedOutput}`
      : picked.content;

  return {
    todos: working,
    handoff: {
      agentId: picked.assignee!,
      content: invokeContent,
      todoId: picked.id,
    },
  };
}

export async function advanceAfterRun(options: {
  storage: Storage;
  channelId: string;
  threadId?: string;
  endedAgentId: string;
  lastAgentOutput?: string;
}): Promise<AdvanceResult['handoff']> {
  const { storage, channelId, threadId, endedAgentId, lastAgentOutput } = options;
  if (!threadId) return null;

  const details = await storage.getThreadDetails({ channelId, threadId });
  const todos = readTodosFromState(details?.state);
  if (todos.length === 0) return null;

  const { todos: nextList, handoff } = advanceTodos(todos, endedAgentId, lastAgentOutput);

  const changed =
    nextList.length !== todos.length ||
    nextList.some((t, i) => {
      const u = todos[i];
      if (!u) return true;
      return (
        t.status !== u.status ||
        t.updatedAt !== u.updatedAt ||
        t.result !== u.result ||
        t.assignee !== u.assignee ||
        t.content !== u.content
      );
    });
  if (changed) {
    await storage.patchThreadState({ channelId, threadId, state: { todos: nextList } });
  }
  return handoff;
}
