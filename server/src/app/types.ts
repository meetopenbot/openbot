export type UIEvent = { type: "ui" }

export interface SimpleMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | any[];
  attachments?: AttachmentRef[];
  meta?: {
    agentId?: string;
    [key: string]: any;
  };
}

type ChatEventBase<T extends string, D> = { type: T } & D & {
  type: T;
  meta?: {
    agentId?: string;
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

export type UserInputEvent = ChatEventBase<"user:input", {
  content: string;
  attachments?: AttachmentRef[];
}>;

/** First-class timeline row: one agent routed work to another (server or future emitters). */
export type AgentHandoffEvent = ChatEventBase<
  "agent:handoff",
  {
    handoffId: string;
    fromAgentId: string;
    toAgentId: string;
    content: string;
  }
>;

/**
 * Internal trigger for “run this agent on this text” without impersonating a user `user:input`.
 * Melony always re-emits the triggering event first; the server skips persisting that echo
 * because `agent:handoff` is the user-visible anchor.
 */
export type AgentInvokeEvent = ChatEventBase<
  "agent:invoke",
  {
    content: string;
    attachments?: AttachmentRef[];
    handoffId?: string;
  }
>;

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

export type RunEvent = ChatEventBase<
  "run:started" | "run:cancelled" | "run:finished" | "run:failed",
  { runId: string; message?: string }
>;

export type ConversationEvent = (
  | UserInputEvent
  | AgentHandoffEvent
  | AgentInvokeEvent
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
  | RunEvent
) & {
  meta?: {
    agentId?: string;
    [key: string]: any;
  };
};

export type RunJob = {
  conversationId: string;
  runId: string;
  event: ConversationEvent;
};

/**
 * Root conversation state; all agents share a single top-level state object.
 */
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

  /** Dynamic top-level state for session-wide data (e.g. project_plan, todos) */
  [key: string]: any;
}

