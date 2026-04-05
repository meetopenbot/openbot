export type UIEvent = { type: "ui" }

export interface SimpleMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | any[];
  attachments?: AttachmentRef[];
}

type ChatEventBase<T extends string, D> = { type: T } & D & {
  type: T;
  meta?: {
    agentName?: string;
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

/** Timeline anchor for agent-to-agent handoff. */
export type AgentDelegationEvent = ChatEventBase<
  "agent:delegation",
  { targetAgentId: string; content: string }
>;
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

export type SuspendEvent = ChatEventBase<"suspend", {
  reason?: string;
  id?: string;
  event?: ConversationEvent;
}>;

export type MessageReactionEvent = ChatEventBase<"message:reaction", {
  targetMessageId: string;
  reaction: "like" | "dislike" | "none";
}>;

export type ConversationEvent = (
  | AgentInputEvent
  | AgentDelegationEvent
  | AgentOutputEvent
  | AgentOutputDeltaEvent
  | UIEvent
  | ActionResultEvent
  | ActionEvent
  | BrowserStatusEvent
  | BrowserStateUpdateEvent
  | UsageUpdateEvent
  | ExecutionStateEvent
  | SuspendEvent
  | MessageReactionEvent
) & {
  meta?: {
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
  /** Current conversation/channel id. */
  conversationId?: string;
  /** The id of this agent (e.g. "os", "default"). */
  agentId?: string;
  /** See ConversationState.openBotExecutingAgentId — set by router during agent runs. */
  openBotExecutingAgentId?: string;
  /** Filled by the server after an awaited delegated run; read by `action:mention` on this agent bucket. Not persisted intentionally. */
  openBotDelegationToolFeedback?: { toolCallId: string; result: string };
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
  lastEventId?: string;
  lastEventAt?: number;
  readByUser?: Record<
    string,
    {
      lastReadEventId?: string;
      lastReadAt?: number;
    }
  >;
  messages?: SimpleMessage[];
  cwd?: string;
  openbotRoot?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  /** Isolated state per agent, keyed by agent name */
  agentStates?: Record<string, AgentState>;

  /** Set by the router while an agent Melony runtime is executing (tools e.g. mention). Not persisted intentionally. */
  openBotExecutingAgentId?: string;

  /**
   * Filled by the server after an awaited delegated run completes so `action:mention` can return real output to the delegator.
   * Cleared by the mention plugin when emitting `action:result`. Not persisted intentionally.
   */
  openBotDelegationToolFeedback?: { toolCallId: string; result: string };

  /** Dynamic top-level state for session-wide data (e.g. project_plan, todos) */
  [key: string]: any;
}

