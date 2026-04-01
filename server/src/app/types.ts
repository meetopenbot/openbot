export type UIEvent = { type: "ui" }

export interface SimpleMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | any[];
  attachments?: AttachmentRef[];
  threadId?: string;
}

type ChatEventBase<T extends string, D> = { type: T } & D & {
  type: T;
  meta?: {
    delegationId?: string;
    agentName?: string;
    threadId?: string;
    [key: string]: any;
  };
};

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

export type ActionResultEvent = ChatEventBase<"action:result", {
  action: string;
  result: any;
  toolCallId?: string;
  error?: string;
  success?: boolean;
  halt?: boolean;
}>;
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

export type AgentSubInputEvent = ChatEventBase<"agent:sub-input", any>;
export type AgentSubActionEvent = ChatEventBase<"agent:sub-action", any>;
export type AgentSubActionResultEvent = ChatEventBase<"agent:sub-action-result", any>;
export type AgentSubUsageEvent = ChatEventBase<"agent:sub-usage", any>;

export type DelegationStartEvent = ChatEventBase<"delegation:start", {
  agent: string;
  task: string;
}>;
export type DelegationEndEvent = ChatEventBase<"delegation:end", {
  agent: string;
  result: any;
}>;
export type SuspendEvent = ChatEventBase<"suspend", {
  reason?: string;
  id?: string;
  event?: ConversationEvent;
}>;

export type ConversationEvent = (
  | AgentInputEvent
  | AgentOutputEvent
  | AgentOutputDeltaEvent
  | UIEvent
  | ActionResultEvent
  | ActionEvent
  | BrowserStatusEvent
  | BrowserStateUpdateEvent
  | UsageUpdateEvent
  | ExecutionStateEvent
  | AgentSubInputEvent
  | AgentSubActionEvent
  | AgentSubActionResultEvent
  | AgentSubUsageEvent
  | DelegationStartEvent
  | DelegationEndEvent
  | SuspendEvent
) & {
  meta?: {
    delegationId?: string;
    agentName?: string;
    [key: string]: any;
  };
};

/**
 * Per-agent isolated state. Each agent runtime gets its own instance,
 * stored in `ConversationState.agentStates[agentName]`.
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

export interface ConversationState {
  title?: string;
  conversationId?: string;
  messages?: SimpleMessage[];
  cwd?: string;
  workspaceRoot?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  pendingAgentTasks?: Record<string, {
    toolCallId: string;
    agentName: string;
    delegatorAgentId?: string;
    delegationId: string;
    stateKey?: string;
  }>;
  /** Isolated state per agent, keyed by agent name */
  agentStates?: Record<string, AgentState>;

  /** Map of threadId to assigned agent name/id */
  threadAssignees?: Record<string, string>;

  /** Dynamic top-level state for session-wide data (e.g. project_plan, todos) */
  [key: string]: any;
}

export interface ConversationRequest {
  event: ConversationEvent;
  runId?: string;
  conversationId?: string;
}
