import {
  AgentInvokeEvent,
  DelegateResultEvent,
  DelegationRequestEvent,
  HandoffRequestEvent,
  OpenBotEvent,
  OpenBotState,
} from '../app/types.js';
import { ensureEventId } from '../app/utils.js';
import { storageService } from '../services/storage.js';

export interface QueueItem {
  agentId: string;
  event: OpenBotEvent;
  delegationContext?: {
    parentAgentId: string;
    toolCallId: string;
    delegationWidgetId?: string;
  };
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
            const { event: currentEvent, delegationContext } = item;

            // Track delegation/handoff requests queued in this step to avoid accidental duplicates.
            const queuedRequestKeys = new Set<string>();
            const queuedItems: QueueItem[] = [];
            const runOutputs: string[] = [];

            const runOnEvent = async (chunk: OpenBotEvent, state: OpenBotState) => {
              // 0. Filter out echoed input events to prevent duplication in the UI/storage
              if (chunk.type === currentEvent.type && chunk.id === currentEvent.id) {
                return false;
              }

              // 1. Detect if a new thread was created and update the context for the rest of the loop
              if (chunk.type === 'action:create_thread:result' && chunk.data.success) {
                this.currentThreadId = chunk.data.threadId || this.currentThreadId;
              }

              // 2. Internal routing (handoff/delegation requests are internal — not forwarded)
              if (chunk.type === 'handoff:request' || chunk.type === 'delegation:request') {
                const isHandoff = chunk.type === 'handoff:request';
                const request = isHandoff
                  ? (chunk as HandoffRequestEvent)
                  : (chunk as DelegationRequestEvent);
                const targetAgentId = request.data?.agentId;
                const toolCallId =
                  typeof request.meta?.toolCallId === 'string'
                    ? request.meta.toolCallId
                    : undefined;
                const requestKey = isHandoff
                  ? `handoff:${targetAgentId}:${request.data?.content ?? ''}`
                  : `delegate:${toolCallId ?? 'missing'}:${targetAgentId}:${request.data?.content ?? ''}`;
                
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

                  if (isHandoff) {
                    queuedItems.push({ agentId: targetAgentId, event: targetEvent });
                  } else {
                    if (!toolCallId) {
                      // Emit error output (this triggers run start if not already started)
                      await runOnEvent(
                        ensureEventId({
                          type: 'agent:output',
                          data: {
                            content:
                              'Delegation request ignored: missing toolCallId. Please retry delegation.',
                          },
                          meta: {
                            agentId,
                            threadId: this.currentThreadId,
                          },
                        } as OpenBotEvent),
                        state,
                      );
                      return true;
                    }
                    const parentAgentId =
                      typeof request.meta?.parentAgentId === 'string'
                        ? request.meta.parentAgentId
                        : agentId;
                    const delegationWidgetId =
                      typeof request.meta?.delegationWidgetId === 'string'
                        ? request.meta.delegationWidgetId
                        : undefined;
                    queuedItems.push({
                      agentId: targetAgentId,
                      event: targetEvent,
                      delegationContext: {
                        parentAgentId,
                        toolCallId,
                        delegationWidgetId,
                      },
                    });
                  }
                }
                return false;
              }

              if (chunk.type === 'agent:output') {
                const content = chunk.data?.content;
                if (typeof content === 'string' && content.trim().length > 0) {
                  runOutputs.push(content.trim());
                }
              }

              // For delegate mode, child agent execution is internal:
              // capture outputs for parent tool result, but don't stream child events to clients/storage.
              if (delegationContext) {
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
                  threadId: this.currentThreadId 
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
                    threadId: this.currentThreadId 
                  },
                },
                endState,
              );
            }

            if (delegationContext) {
              const summary =
                runOutputs.length > 0
                  ? runOutputs.join('\n\n').slice(0, 4000)
                  : `Delegated agent "${agentId}" completed with no textual output.`;
              
              const delegateResultEvent: DelegateResultEvent = ensureEventId({
                type: 'action:delegate:result',
                data: {
                  success: true,
                  agentId,
                  summary,
                },
                meta: {
                  toolCallId: delegationContext.toolCallId,
                  agentId: delegationContext.parentAgentId,
                  threadId: this.currentThreadId,
                },
              } satisfies DelegateResultEvent) as DelegateResultEvent;

              if (delegationContext.delegationWidgetId) {
                await this.options.onEvent(
                  ensureEventId({
                    type: 'client:ui:widget',
                    data: {
                      kind: 'message',
                      widgetId: delegationContext.delegationWidgetId,
                      title: `Delegation complete: ${agentId}`,
                      body:
                        runOutputs.length > 0
                          ? 'Delegated task finished. Parent agent is preparing final response.'
                          : 'Delegated task finished with no textual output. Parent agent will continue.',
                      state: 'submitted',
                      metadata: {
                        type: 'delegation:status',
                        phase: 'completed',
                        delegatedAgentId: agentId,
                      },
                    },
                    meta: {
                      agentId: delegationContext.parentAgentId,
                      threadId: this.currentThreadId,
                    },
                  } as OpenBotEvent),
                  await storageService.getOpenBotState({
                    runId: this.options.runId,
                    agentId: delegationContext.parentAgentId,
                    channelId: this.options.channelId,
                    threadId: this.currentThreadId,
                    event: delegateResultEvent,
                  }),
                );
              }

              nextQueue.push({
                agentId: delegationContext.parentAgentId,
                event: delegateResultEvent,
              });
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
