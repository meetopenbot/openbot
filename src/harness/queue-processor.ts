import {
  AgentInvokeEvent,
  HandoffRequestEvent,
  OpenBotEvent,
  OpenBotState,
} from '../app/types.js';
import { ensureEventId } from '../app/utils.js';
import { storageService } from '../services/storage.js';
import { advanceAfterRun } from './todo-advance.js';

export interface QueueItem {
  agentId: string;
  event: OpenBotEvent;
}

export interface QueueProcessorOptions {
  runId: string;
  channelId: string;
  threadId?: string;
  onEvent: (chunk: OpenBotEvent, state: OpenBotState) => Promise<boolean | void>;
  executeAgent: (options: {
    runId: string;
    agentId: string;
    event: OpenBotEvent;
    channelId: string;
    threadId?: string;
    onEvent: (chunk: OpenBotEvent, state: OpenBotState) => Promise<boolean | void>;
  }) => Promise<void>;
}

export class QueueProcessor {
  private currentQueue: QueueItem[] = [];
  private currentThreadId?: string;
  private readonly MAX_ITERATIONS = 20;

  constructor(private options: QueueProcessorOptions) {
    this.currentThreadId = options.threadId;
  }

  enqueue(item: QueueItem) {
    this.currentQueue.push(item);
  }

  async run() {
    let iterations = 0;

    while (this.currentQueue.length > 0 && iterations < this.MAX_ITERATIONS) {
      iterations++;

      // Group by agentId to avoid parallel state corruption for the same agent.
      const groups = new Map<string, QueueItem[]>();
      for (const item of this.currentQueue) {
        const list = groups.get(item.agentId) || [];
        list.push(item);
        groups.set(item.agentId, list);
      }

      const nextQueue: QueueItem[] = [];

      // Run each agent group in parallel
      await Promise.all(
        Array.from(groups.entries()).map(async ([agentId, items]) => {
          // Run items for the SAME agent sequentially to preserve event order and state consistency.
          for (const item of items) {
            const { event: currentEvent } = item;

            // Track handoff requests queued in this step to avoid accidental duplicates.
            const queuedRequestKeys = new Set<string>();
            const queuedItems: QueueItem[] = [];
            let lastAgentOutput: string | undefined;

            const runOnEvent = async (chunk: OpenBotEvent, state: OpenBotState) => {
              // 0. Filter out echoed input events to prevent duplication in the UI/storage
              if (chunk.type === currentEvent.type && chunk.id === currentEvent.id) {
                return false;
              }

              if (chunk.type === 'agent:output') {
                const outMeta = chunk.meta as { agentId?: string } | undefined;
                if (outMeta?.agentId === agentId) {
                  const content = chunk.data?.content;
                  if (typeof content === 'string' && content.trim()) {
                    lastAgentOutput = content.trim();
                  }
                }
              }

              // 1. Detect if a new thread was created and update the context for the rest of the loop
              if (chunk.type === 'action:create_thread:result' && chunk.data.success) {
                this.currentThreadId = chunk.data.threadId || this.currentThreadId;
              }

              // 2. Internal routing (handoff requests are internal — not forwarded)
              if (chunk.type === 'handoff:request') {
                const request = chunk as HandoffRequestEvent;
                const targetAgentId = request.data?.agentId;
                const requestKey = `handoff:${targetAgentId}`;

                if (
                  targetAgentId &&
                  targetAgentId !== agentId &&
                  !queuedRequestKeys.has(requestKey)
                ) {
                  queuedRequestKeys.add(requestKey);
                  const targetEvent = ensureEventId({
                    type: 'agent:invoke',
                    data: {
                      role: 'user',
                      content: request.data.content,
                    },
                    meta: {
                      ...(request.meta || {}),
                      threadId: this.currentThreadId,
                    },
                  } satisfies AgentInvokeEvent) as AgentInvokeEvent;

                  queuedItems.push({ agentId: targetAgentId, event: targetEvent });
                }
                return false;
              }

              // If we get here, the event is accepted and should be emitted.
              await this.options.onEvent(chunk, state);
              return true;
            };

            const startState = await storageService.getOpenBotState({
              runId: this.options.runId,
              agentId,
              channelId: this.options.channelId,
              threadId: this.currentThreadId,
              event: currentEvent,
            });

            await this.options.onEvent(
              {
                type: 'agent:run:start',
                data: {
                  runId: this.options.runId,
                  agentId,
                  channelId: this.options.channelId,
                  threadId: this.currentThreadId,
                },
              },
              startState,
            );

            try {
              await this.options.executeAgent({
                runId: this.options.runId,
                agentId,
                event: currentEvent,
                channelId: this.options.channelId,
                threadId: this.currentThreadId,
                onEvent: runOnEvent,
              });
            } finally {
              const endState = await storageService.getOpenBotState({
                runId: this.options.runId,
                agentId,
                channelId: this.options.channelId,
                threadId: this.currentThreadId,
                event: currentEvent,
              });
              await this.options.onEvent(
                {
                  type: 'agent:run:end',
                  data: {
                    runId: this.options.runId,
                    agentId,
                    channelId: this.options.channelId,
                    threadId: this.currentThreadId,
                  },
                },
                endState,
              );

              // Autonomous todo advance: mark this agent's in_progress todo done
              // and dispatch the next assignee, if any. Single trigger point,
              // no reliance on the LLM remembering to call `todo_update`.
              try {
                const handoff = await advanceAfterRun({
                  storage: storageService,
                  channelId: this.options.channelId,
                  threadId: this.currentThreadId,
                  endedAgentId: agentId,
                  lastAgentOutput,
                });
                if (handoff) {
                  const requestKey = `handoff:${handoff.agentId}`;
                  if (!queuedRequestKeys.has(requestKey)) {
                    queuedRequestKeys.add(requestKey);
                    const targetEvent = ensureEventId({
                      type: 'agent:invoke',
                      data: { role: 'user', content: handoff.content },
                      meta: { threadId: this.currentThreadId },
                    } satisfies AgentInvokeEvent) as AgentInvokeEvent;
                    queuedItems.push({ agentId: handoff.agentId, event: targetEvent });
                  }
                }
              } catch (error) {
                console.warn('[queue] todo advance failed', error);
              }
            }

            nextQueue.push(...queuedItems);
          }
        }),
      );

      this.currentQueue = nextQueue;
    }

    if (iterations >= this.MAX_ITERATIONS) {
      console.warn(
        `[orchestrator] Reached MAX_ITERATIONS (${this.MAX_ITERATIONS}). Stopping execution.`,
      );
    }
  }
}
