import { OpenBotEvent, OpenBotState } from '../app/types.js';

/**
 * The Harness is the environment in which an agent operates.
 * it provides the necessary "plumbing" (storage, communication, tools) 
 * so the agent can focus on reasoning.
 */
export interface Harness {
  readonly runId: string;
  readonly channelId: string;
  readonly threadId?: string;
  
  /**
   * Dispatches an event into the harness.
   * This is the primary way to interact with the agent.
   */
  dispatch(event: OpenBotEvent): Promise<void>;

  /**
   * Observes events emitted by the harness.
   */
  onEvent(callback: (event: OpenBotEvent, state: OpenBotState) => Promise<void>): void;
}

/**
 * Options for creating a new Agent Harness instance.
 */
export interface HarnessOptions {
  runId: string;
  agentId: string;
  channelId: string;
  threadId?: string;
  onEvent: (event: OpenBotEvent, state: OpenBotState) => Promise<void>;
}
