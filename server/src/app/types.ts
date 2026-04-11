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

export type RunEvent = ChatEventBase<
  "run:started" | "run:cancelled" | "run:finished" | "run:failed",
  { runId: string; message?: string }
>;

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
  delegation?: {
    parentDelegationId: string;
    toolCallId: string;
    leadAgentId: string;
    depth: number;
  };
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

