import { Runtime } from 'melony';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import { Harness, HarnessOptions } from './types.js';
import { orchestratorService } from './orchestrator.js';
import { ensureEventId } from '../app/utils.js';

/**
 * Standard implementation of the Agent Harness.
 * It wraps the orchestrator logic into a clean, stateful container.
 */
export class AgentHarness implements Harness {
  public readonly runId: string;
  public readonly agentId: string;
  public readonly channelId: string;
  public threadId?: string;
  private eventCallbacks: ((event: OpenBotEvent, state: OpenBotState) => Promise<void>)[] = [];

  constructor(options: HarnessOptions) {
    this.runId = options.runId;
    this.agentId = options.agentId;
    this.channelId = options.channelId;
    this.threadId = options.threadId;
    if (options.onEvent) {
      this.eventCallbacks.push(options.onEvent);
    }
  }

  /**
   * Dispatches an event to the agent within this harness.
   */
  async dispatch(event: OpenBotEvent): Promise<void> {
    ensureEventId(event);

    await orchestratorService.dispatch({
      runId: this.runId,
      agentId: this.agentId,
      event,
      channelId: this.channelId,
      threadId: this.threadId,
      onEvent: async (chunk, state) => {
        // Update internal thread state if it changes (e.g. thread creation)
        if (chunk.type === 'action:create_thread:result' && chunk.data.success) {
          this.threadId = chunk.data.threadId || this.threadId;
        }

        // Notify all observers
        await Promise.all(this.eventCallbacks.map(cb => cb(chunk, state)));
      }
    });
  }

  /**
   * Adds an event listener to the harness.
   */
  onEvent(callback: (event: OpenBotEvent, state: OpenBotState) => Promise<void>): void {
    this.eventCallbacks.push(callback);
  }
}
