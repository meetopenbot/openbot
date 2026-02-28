import type { Event } from "melony";
import type { UIEvent } from "@melony/ui-kit";
export interface SimpleMessage {
  role: "system" | "user" | "assistant";
  content: string;
  attachments?: AttachmentRef[];
}

type ChatEventBase<T extends string, D> = Event<D> & { type: T };

export interface AttachmentRef {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
}

export type AgentInputEvent = ChatEventBase<"agent:input", {
  content: string;
  attachments?: AttachmentRef[];
}>;
export type AgentOutputEvent = ChatEventBase<"agent:output", { content: string }>;
export type AgentOutputDeltaEvent = ChatEventBase<"agent:output-delta", { delta: string; content: string }>;

export type ActionResultEvent = ChatEventBase<"action:result", { action: string; result: any; toolCallId?: string; error?: string }>;
export type ActionEvent = ChatEventBase<`action:${string}`, any>;

export type BrowserStatusEvent = ChatEventBase<"browser:status", { message: string; severity?: "info" | "success" | "error" }>;
export type BrowserStateUpdateEvent = ChatEventBase<"browser:state-update", { url: string; title: string; screenshot?: string; pagesCount: number }>;
export type UsageUpdateEvent = ChatEventBase<"usage:update", {
  scope?: string;
  model?: string;
  turn: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  session: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}>;

export type ExecutionStateEvent = ChatEventBase<"execution:state", {
  traceId: string;
  state: string;
  currentStepId?: string;
  error?: string;
  intentType?: string;
  planSteps?: number;
}>;

export type ChatEvent =
  | AgentInputEvent
  | AgentOutputEvent
  | AgentOutputDeltaEvent
  | UIEvent
  | ActionResultEvent
  | ActionEvent
  | BrowserStatusEvent
  | BrowserStateUpdateEvent
  | UsageUpdateEvent
  | ExecutionStateEvent;

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
  messages?: SimpleMessage[];
  cwd?: string;
  workspaceRoot?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  pendingAgentTasks?: Record<string, { toolCallId: string }>;
  /** Isolated state per agent, keyed by agent name */
  agentStates?: Record<string, AgentState>;
}

export interface ChatRequest {
  event: ChatEvent;
  runId?: string;
  sessionId?: string;
}
