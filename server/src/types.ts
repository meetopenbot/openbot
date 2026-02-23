import type { Event } from "melony";
import type { UIEvent } from "@melony/ui-kit";

type ChatEventBase<T extends string, D> = Event<D> & { type: T };

export type UserTextEvent = ChatEventBase<"user:text", { content: string }>;
export type ManagerInputEvent = ChatEventBase<"manager:input", { content: string }>;
export type AssistantTextEvent = ChatEventBase<"assistant:text", { content: string }>;

export type ActionTaskResultEvent = ChatEventBase<"action:taskResult", { action: string; result: any; toolCallId?: string; error?: string }>;
export type ActionEvent = ChatEventBase<`action:${string}`, any>;

export type AgentInputEvent = ChatEventBase<`agent:${string}:input`, { content: string }>;
export type AgentOutputEvent = ChatEventBase<`agent:${string}:output`, { content: string }>;

export type BrowserStatusEvent = ChatEventBase<"browser:status", { message: string; severity?: "info" | "success" | "error" }>;
export type BrowserStateUpdateEvent = ChatEventBase<"browser:state-update", { url: string; title: string; screenshot?: string; pagesCount: number }>;

export type ChatEvent =
  | UserTextEvent
  | ManagerInputEvent
  | AssistantTextEvent
  | UIEvent
  | ActionTaskResultEvent
  | ActionEvent
  | AgentInputEvent
  | AgentOutputEvent
  | BrowserStatusEvent
  | BrowserStateUpdateEvent;

/**
 * Per-agent isolated state. Each agent runtime gets its own instance,
 * stored in `ChatState.agentStates[agentName]`.
 */
export interface AgentState {
  messages?: any[];
  cwd?: string;
  pendingApprovals?: Record<string, any>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface ChatState {
  title?: string;
  sessionId?: string;
  lastUserMessage?: string;
  /** Manager conversation history */
  messages?: any[];
  cwd?: string;
  workspaceRoot?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  pendingAgentTasks?: Record<string, { toolCallId: string }>;
  lastDirectAgent?: string;
  /** Isolated state per agent, keyed by agent name */
  agentStates?: Record<string, AgentState>;
}

export interface ChatRequest {
  event: ChatEvent;
  runId?: string;
  sessionId?: string;
}
