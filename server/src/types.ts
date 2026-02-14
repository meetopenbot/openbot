import type { Event } from "melony";
import type { UIEvent } from "@melony/ui-kit";

type ChatEventBase<T extends string, D> = Event<D> & { type: T };

export type InitEvent = ChatEventBase<"init", { platform: string; version?: string; tab?: string }>;
export type SessionChangeEvent = ChatEventBase<"sessionChange", { platform: string; tab?: string; sessionId: string }>;
export type TabChangeEvent = ChatEventBase<"tabChange", { platform: string; tab: string; sessionId: string }>;
export type UserTextEvent = ChatEventBase<"user:text", { content: string }>;
export type AssistantTextEvent = ChatEventBase<"assistant:text", { content: string }>;

export type ActionTaskResultEvent = ChatEventBase<"action:taskResult", { action: string; result: any; toolCallId?: string; error?: string }>;
export type ActionEvent = ChatEventBase<`action:${string}`, any>;

// Generic agent events — work for any registered agent name
export type AgentInputEvent = ChatEventBase<`agent:${string}:input`, { content: string }>;
export type AgentOutputEvent = ChatEventBase<`agent:${string}:output`, { content: string }>;

export type BrowserStatusEvent = ChatEventBase<"browser:status", { message: string; severity?: "info" | "success" | "error" }>;
export type BrowserStateUpdateEvent = ChatEventBase<"browser:state-update", { url: string; title: string; screenshot?: string; pagesCount: number }>;
export type UpdateSettingsEvent = ChatEventBase<"action:updateSettings", { model?: string; openai_api_key?: string; anthropic_api_key?: string }>;

export type ChatEvent =
  | InitEvent
  | SessionChangeEvent
  | TabChangeEvent
  | UserTextEvent
  | AssistantTextEvent
  | UIEvent
  | ActionTaskResultEvent
  | ActionEvent
  | AgentInputEvent
  | AgentOutputEvent
  | BrowserStatusEvent
  | BrowserStateUpdateEvent
  | UpdateSettingsEvent;

export interface ChatState {
  title?: string;
  sessionId?: string;
  lastUserMessage?: string;
  messages?: any[];
  cwd?: string;
  workspaceRoot?: string;
  /** Accumulated LLM usage for the current session */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  /** Generic map of pending delegated tasks, keyed by agent name */
  pendingAgentTasks?: Record<string, { toolCallId: string }>;
}

export interface ChatRequest {
  event: ChatEvent;
  runId?: string;
  sessionId?: string;
}
