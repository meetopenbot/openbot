import {
  Agent,
  AgentDetails,
  Channel,
  ChannelDetails,
  PluginDescriptor,
  Thread,
  ThreadDetails,
} from '../bus/types.js';
import type { PluginRef } from '../bus/plugin.js';
import type { MemoryRecord } from '../services/memory.js';

export interface OpenBotState {
  agentId: string;
  runId: string;
  channelId: string;
  threadId?: string;
  agentDetails?: AgentDetails;
  channelDetails?: ChannelDetails;
  threadDetails?: ThreadDetails;
  triggerEvent?: OpenBotEvent;
  shortTermMessages?: ShortTermMessage[];
}

export type ShortTermMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: any[] }
  | { role: 'tool'; content: string; toolCallId: string; toolName: string };

export type BaseEvent = {
  id?: string;
  type: string;
  meta?: any;
};

export type AgentInvokeEvent = BaseEvent & {
  type: 'agent:invoke';
  data: {
    role?: 'user' | 'assistant' | 'system';
    content: string;
    agentId?: string;
  };
};

export type GetChannelsEvent = BaseEvent & {
  type: 'action:storage:get-channels';
};

export type GetChannelsResultEvent = BaseEvent & {
  type: 'action:storage:get-channels-result';
  data: {
    channels: Channel[];
  };
};

export type GetThreadsEvent = BaseEvent & {
  type: 'action:storage:get-threads';
  data: {
    channelId: string;
  };
};

export type GetThreadsResultEvent = BaseEvent & {
  type: 'action:storage:get-threads-result';
  data: {
    threads: Thread[];
  };
};

export type GetChannelDetailsEvent = BaseEvent & {
  type: 'action:storage:get-channel-details';
};

export type GetChannelDetailsResultEvent = BaseEvent & {
  type: 'action:storage:get-channel-details-result';
  data: {
    channelDetails: ChannelDetails;
  };
};

export type GetThreadDetailsEvent = BaseEvent & {
  type: 'action:storage:get-thread-details';
};

export type GetThreadDetailsResultEvent = BaseEvent & {
  type: 'action:storage:get-thread-details-result';
  data: {
    threadDetails: ThreadDetails | null;
  };
};

export type GetAgentsEvent = BaseEvent & {
  type: 'action:storage:get-agents';
};

export type GetAgentsResultEvent = BaseEvent & {
  type: 'action:storage:get-agents-result';
  data: {
    agents: Agent[];
  };
};

export type GetPluginsEvent = BaseEvent & {
  type: 'action:storage:get-plugins';
};

export type GetPluginsResultEvent = BaseEvent & {
  type: 'action:storage:get-plugins-result';
  data: {
    plugins: PluginDescriptor[];
  };
};

export type GetEventsEvent = BaseEvent & {
  type: 'action:storage:get-events';
};

export type GetEventsResultEvent = BaseEvent & {
  type: 'action:storage:get-events-result';
  data: {
    events: OpenBotEvent[];
  };
};

export type GetAgentDetailsEvent = BaseEvent & {
  type: 'action:storage:get-agent-details';
  data: {
    agentId: string;
  };
};

export type GetAgentDetailsResultEvent = BaseEvent & {
  type: 'action:storage:get-agent-details-result';
  data: {
    agentDetails: AgentDetails;
  };
};

export type CreateAgentEvent = BaseEvent & {
  type: 'action:storage:create-agent';
  data: {
    agentId: string;
    name: string;
    description?: string;
    instructions: string;
    plugins: PluginRef[];
  };
};

export type CreateAgentResultEvent = BaseEvent & {
  type: 'action:storage:create-agent-result';
  data: {
    success: boolean;
    error?: string;
  };
};

export type UpdateAgentEvent = BaseEvent & {
  type: 'action:storage:update-agent';
  data: {
    agentId: string;
    name?: string;
    description?: string;
    instructions?: string;
    plugins?: PluginRef[];
  };
};

export type UpdateAgentResultEvent = BaseEvent & {
  type: 'action:storage:update-agent-result';
  data: {
    success: boolean;
    error?: string;
  };
};

export type DeleteAgentEvent = BaseEvent & {
  type: 'action:storage:delete-agent';
  data: {
    agentId: string;
  };
};

export type DeleteAgentResultEvent = BaseEvent & {
  type: 'action:storage:delete-agent-result';
  data: {
    success: boolean;
    error?: string;
  };
};

export type StreamThreadEvent = BaseEvent & {
  type: 'stream:thread';
  data: {
    channelId: string;
    threadId?: string;
  };
};

export type GetVariablesEvent = BaseEvent & {
  type: 'action:storage:get-variables';
};

export type GetVariablesResultEvent = BaseEvent & {
  type: 'action:storage:get-variables-result';
  data: {
    variables: Record<string, string | { value: string; secret: boolean }>;
  };
};

export type CreateVariableEvent = BaseEvent & {
  type: 'action:storage:create-variable';
  data: {
    key: string;
    value: string;
    secret?: boolean;
  };
};

export type CreateVariableResultEvent = BaseEvent & {
  type: 'action:storage:create-variable-result';
  data: {
    success: boolean;
    error?: string;
  };
};

export type DeleteVariableEvent = BaseEvent & {
  type: 'action:storage:delete-variable';
  data: {
    key: string;
  };
};

export type DeleteVariableResultEvent = BaseEvent & {
  type: 'action:storage:delete-variable-result';
  data: {
    success: boolean;
    error?: string;
  };
};

export type PatchChannelStateEvent = BaseEvent & {
  type: 'action:storage:patch-channel-state';
  data: {
    state: unknown;
  };
};

export type PatchChannelStateResultEvent = BaseEvent & {
  type: 'action:storage:patch-channel-state-result';
  data: {
    success: boolean;
  };
};

export type PatchThreadStateEvent = BaseEvent & {
  type: 'action:storage:patch-thread-state';
  data: {
    state: unknown;
  };
};

export type PatchThreadStateResultEvent = BaseEvent & {
  type: 'action:storage:patch-thread-state-result';
  data: {
    success: boolean;
  };
};

export type PatchChannelDetailsEvent = BaseEvent & {
  type: 'action:patch_channel_details';
  data: {
    state?: Record<string, unknown>;
    spec?: string;
    cwd?: string;
  };
};

export type PatchChannelDetailsResultEvent = BaseEvent & {
  type: 'action:patch_channel_details:result';
  data: {
    success: boolean;
    updatedFields: ('state' | 'spec' | 'cwd')[];
  };
};

export type PatchThreadDetailsEvent = BaseEvent & {
  type: 'action:patch_thread_details';
  data: {
    state?: Record<string, unknown>;
  };
};

export type PatchThreadDetailsResultEvent = BaseEvent & {
  type: 'action:patch_thread_details:result';
  data: {
    success: boolean;
    updatedFields: ('state')[];
  };
};

export type ListFilesEvent = BaseEvent & {
  type: 'action:storage:list-files';
  data: {
    path?: string;
  };
};

export type ListFilesResultEvent = BaseEvent & {
  type: 'action:storage:list-files:result';
  data: {
    success: boolean;
    files: Array<{ name: string; isDirectory: boolean }>;
    error?: string;
  };
};

export type ReadFileEvent = BaseEvent & {
  type: 'action:storage:read-file';
  data: {
    path: string;
  };
};

export type ReadFileResultEvent = BaseEvent & {
  type: 'action:storage:read-file:result';
  data: {
    success: boolean;
    content?: string;
    path: string;
    error?: string;
  };
};

export type AgentOutputEvent = BaseEvent & {
  type: 'agent:output';
  data: {
    content: string;
  };
  meta: {
    agentId: string;
    [key: string]: any;
  };
};

export type AgentRunStartEvent = BaseEvent & {
  type: 'agent:run:start';
  data: {
    runId: string;
    agentId: string;
    channelId: string;
    threadId?: string;
  };
};

export type AgentRunEndEvent = BaseEvent & {
  type: 'agent:run:end';
  data: {
    runId: string;
    agentId: string;
    channelId: string;
    threadId?: string;
  };
};

export type AgentRunStoppedEvent = BaseEvent & {
  type: 'agent:run:stopped';
  data: {
    runId: string;
    agentId: string;
    channelId: string;
    threadId?: string;
    reason?: string;
  };
};

export type ActiveRunsSnapshotEvent = BaseEvent & {
  type: 'agent:active-runs:snapshot';
  data: {
    channels: Array<{
      channelId: string;
      threadId?: string;
      activeCount: number;
      agentIds: string[];
    }>;
  };
};

export type StopAgentRunEvent = BaseEvent & {
  type: 'action:agent_run_stop';
  data: {
    runId: string;
    agentId?: string;
    channelId?: string;
    threadId?: string;
    reason?: string;
  };
};

export type StopAgentRunResultEvent = BaseEvent & {
  type: 'action:agent_run_stop:result';
  data: {
    success: boolean;
    message?: string;
  };
};

export type CreateThreadEvent = BaseEvent & {
  type: 'action:create_thread';
  data: {
    threadTitle: string;
    initialState?: Record<string, unknown>;
  };
  meta: {
    toolCallId: string;
    agentId: string;
    threadId: string;
  };
};

export type CreateThreadResultEvent = BaseEvent & {
  type: 'action:create_thread:result';
  data: {
    success: boolean;
    threadId: string;
    threadTitle: string;
  };
  meta: {
    threadId: string;
  };
};

export type CreateChannelEvent = BaseEvent & {
  type: 'action:create_channel';
  data: {
    channelId: string;
    spec?: string;
    initialState?: Record<string, unknown>;
    cwd?: string;
  };
  meta?: {
    toolCallId?: string;
    agentId?: string;
    threadId?: string;
  };
};

export type CreateChannelResultEvent = BaseEvent & {
  type: 'action:create_channel:result';
  data: {
    success: boolean;
    channelId: string;
    channelUrl: string;
  };
};

export type UpdateChannelEvent = BaseEvent & {
  type: 'action:update_channel';
  data: {
    channelId?: string;
    name?: string;
    cwd?: string;
  };
};

export type UpdateChannelResultEvent = BaseEvent & {
  type: 'action:update_channel:result';
  data: {
    success: boolean;
    channelId: string;
    updatedFields: string[];
  };
};

export type UIWidgetAction = {
  id: string;
  label: string;
  value?: unknown;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
};

export type UIWidgetField = {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'multiselect' | 'date';
  description?: string;
  placeholder?: string;
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
  defaultValue?: unknown;
};

export type UIWidgetListItem = {
  id: string;
  label: string;
  description?: string;
  status?: 'pending' | 'in_progress' | 'done' | 'error' | 'cancelled';
  metadata?: Record<string, unknown>;
};

export type UIWidgetBase = {
  widgetId: string;
  title?: string;
  description?: string;
  body?: string;
  state?: 'open' | 'submitted' | 'cancelled' | 'error';
  metadata?: Record<string, unknown>;
};

export type UIMessageWidget = UIWidgetBase & {
  kind: 'message';
  actions?: UIWidgetAction[];
};

export type UIChoiceWidget = UIWidgetBase & {
  kind: 'choice';
  actions: UIWidgetAction[];
};

export type UIFormWidget = UIWidgetBase & {
  kind: 'form';
  fields: UIWidgetField[];
  submitLabel?: string;
  actions?: UIWidgetAction[];
};

export type UIListWidget = UIWidgetBase & {
  kind: 'list';
  items: UIWidgetListItem[];
  actions?: UIWidgetAction[];
};

export type UIWidgetSpec = UIMessageWidget | UIChoiceWidget | UIFormWidget | UIListWidget;

export type RenderUIWidgetData =
  | (Omit<UIMessageWidget, 'widgetId'> & { widgetId?: string })
  | (Omit<UIChoiceWidget, 'widgetId'> & { widgetId?: string })
  | (Omit<UIFormWidget, 'widgetId'> & { widgetId?: string })
  | (Omit<UIListWidget, 'widgetId'> & { widgetId?: string })
  | {
      kind: 'approval' | 'todo_list';
      widgetId?: string;
      title?: string;
      props?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    };

export type UIWidgetEvent = BaseEvent & {
  type: 'client:ui:widget';
  data: UIWidgetSpec;
  meta: {
    agentId: string;
    threadId?: string;
  };
};

export type RenderUIWidgetEvent = BaseEvent & {
  type: 'action:render_ui_widget';
  data: RenderUIWidgetData;
};

export type UIWidgetResponseEvent = BaseEvent & {
  type: 'client:ui:widget:response';
  data: {
    widgetId: string;
    actionId: string;
    values?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
};

export type HandoffEvent = BaseEvent & {
  type: 'action:handoff';
  data: {
    agentId: string;
    content: string;
  };
  meta?: {
    toolCallId?: string;
    [key: string]: any;
  };
};

export type HandoffResultEvent = BaseEvent & {
  type: 'action:handoff:result';
  data: {
    success: boolean;
    agentId: string;
    accepted: boolean;
  };
  meta: {
    toolCallId: string;
    agentId: string;
    threadId?: string;
    [key: string]: any;
  };
};

/** Internal routing: handoff plugin → orchestrator only (not stored or broadcast). */
export type HandoffRequestEvent = BaseEvent & {
  type: 'handoff:request';
  data: {
    agentId: string;
    content: string;
  };
  meta?: Record<string, unknown>;
};

export type MCPListToolsEvent = BaseEvent & {
  type: 'action:mcp_list_tools';
  data: {
    serverId: string;
  };
};

export type MCPListToolsResultEvent = BaseEvent & {
  type: 'action:mcp_list_tools:result';
  data: {
    success: boolean;
    serverId: string;
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
    error?: string;
  };
};

export type MCPCallEvent = BaseEvent & {
  type: 'action:mcp_call';
  data: {
    serverId: string;
    toolName: string;
    args?: Record<string, unknown>;
  };
};

export type MCPCallResultEvent = BaseEvent & {
  type: 'action:mcp_call:result';
  data: {
    success: boolean;
    serverId: string;
    toolName: string;
    result?: unknown;
    error?: string;
  };
};

export type ShellExecEvent = BaseEvent & {
  type: 'action:shell_exec';
  data: {
    command: string;
    cwd?: string;
    shell?: string;
    timeoutMs?: number;
  };
  meta?: {
    toolCallId?: string;
    approvalId?: string;
    approvalStatus?: 'approved' | 'denied';
    [key: string]: any;
  };
};

export type ShellExecResultEvent = BaseEvent & {
  type: 'action:shell_exec:result';
  data: {
    success: boolean;
    approved?: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    error?: string;
  };
};

export type UserInputEvent = BaseEvent & {
  type: 'user:input';
  data: {
    content: string;
  };
  meta?: {
    userId?: string;
    userName?: string;
    userAvatarUrl?: string;
  };
};

export type InstallPluginEvent = BaseEvent & {
  type: 'action:plugin:install';
  data: {
    name: string;
    version?: string;
  };
};

export type InstallPluginResultEvent = BaseEvent & {
  type: 'action:plugin:install:result';
  data: {
    success: boolean;
    plugin?: { name: string; version: string };
    error?: string;
  };
};

export type UninstallPluginEvent = BaseEvent & {
  type: 'action:plugin:uninstall';
  data: {
    id: string;
  };
};

export type UninstallPluginResultEvent = BaseEvent & {
  type: 'action:plugin:uninstall:result';
  data: {
    success: boolean;
    error?: string;
  };
};

export type ListMarketplaceAgentsEvent = BaseEvent & {
  type: 'action:marketplace:list';
};

export type ListMarketplaceAgentsResultEvent = BaseEvent & {
  type: 'action:marketplace:list:result';
  data: {
    success: boolean;
    agents: Array<{
      id: string;
      name: string;
      description: string;
      image?: string;
      instructions: string;
      plugins: PluginRef[];
    }>;
    error?: string;
  };
};

export type InstallAgentEvent = BaseEvent & {
  type: 'action:agent:install';
  data: {
    agentId: string;
    name: string;
    description?: string;
    instructions: string;
    plugins: PluginRef[];
  };
};

export type InstallAgentResultEvent = BaseEvent & {
  type: 'action:agent:install:result';
  data: {
    success: boolean;
    agentId: string;
    error?: string;
  };
};

export type MemoryScopeAlias = 'global' | 'agent' | 'channel';

export type RememberEvent = BaseEvent & {
  type: 'action:remember';
  data: {
    content: string;
    scope?: MemoryScopeAlias;
    tags?: string[];
  };
};

export type RememberResultEvent = BaseEvent & {
  type: 'action:remember:result';
  data: {
    success: boolean;
    record?: MemoryRecord;
    error?: string;
  };
};

export type RecallEvent = BaseEvent & {
  type: 'action:recall';
  data: {
    query?: string;
    tag?: string;
    scope?: MemoryScopeAlias | 'all';
    limit?: number;
  };
};

export type RecallResultEvent = BaseEvent & {
  type: 'action:recall:result';
  data: {
    success: boolean;
    records: MemoryRecord[];
    error?: string;
  };
};

export type ForgetEvent = BaseEvent & {
  type: 'action:forget';
  data: { id: string };
};

export type ForgetResultEvent = BaseEvent & {
  type: 'action:forget:result';
  data: {
    success: boolean;
    deleted: boolean;
    error?: string;
  };
};

export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';

/**
 * A single unit of work tracked in thread state. Todos are owned by the
 * system (bus services); agents can only mutate them by calling the
 * `todo_write` / `todo_update` tools so every change is observable on the
 * event stream and audit-friendly.
 */
export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  /** Optional agent id responsible for this item — drives autonomous handoffs. */
  assignee?: string;
  /** Agent id that created the todo (or "system"). */
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  /**
   * Captured final reply when this item reaches `done` (last `agent:output`
   * from the assignee for that run). Lets downstream agents rely on thread
   * state instead of merged short-term messages.
   */
  result?: string;
}

export type TodoWriteInput = {
  id?: string;
  content: string;
  status?: TodoStatus;
  assignee?: string;
};

export type TodoWriteEvent = BaseEvent & {
  type: 'action:todo_write';
  data: {
    todos: TodoWriteInput[];
  };
  meta?: { toolCallId?: string; agentId?: string; threadId?: string };
};

export type TodoWriteResultEvent = BaseEvent & {
  type: 'action:todo_write:result';
  data: {
    success: boolean;
    todos: TodoItem[];
    error?: string;
  };
  meta?: { toolCallId?: string; agentId?: string; threadId?: string };
};

export type TodoUpdateEvent = BaseEvent & {
  type: 'action:todo_update';
  data: {
    id: string;
    status?: TodoStatus;
    content?: string;
    assignee?: string;
  };
  meta?: { toolCallId?: string; agentId?: string; threadId?: string };
};

export type TodoUpdateResultEvent = BaseEvent & {
  type: 'action:todo_update:result';
  data: {
    success: boolean;
    todo?: TodoItem;
    todos: TodoItem[];
    error?: string;
  };
  meta?: { toolCallId?: string; agentId?: string; threadId?: string };
};

export type OpenBotEvent =
  | UserInputEvent
  | AgentInvokeEvent
  | AgentOutputEvent
  | AgentRunStartEvent
  | AgentRunEndEvent
  | AgentRunStoppedEvent
  | ActiveRunsSnapshotEvent
  | StopAgentRunEvent
  | StopAgentRunResultEvent
  | GetChannelsEvent
  | GetChannelsResultEvent
  | GetThreadsEvent
  | GetThreadsResultEvent
  | GetChannelDetailsEvent
  | GetChannelDetailsResultEvent
  | GetThreadDetailsEvent
  | GetThreadDetailsResultEvent
  | GetAgentsEvent
  | GetAgentsResultEvent
  | GetPluginsEvent
  | GetPluginsResultEvent
  | GetAgentDetailsEvent
  | GetAgentDetailsResultEvent
  | CreateAgentEvent
  | CreateAgentResultEvent
  | UpdateAgentEvent
  | UpdateAgentResultEvent
  | DeleteAgentEvent
  | DeleteAgentResultEvent
  | GetEventsEvent
  | GetEventsResultEvent
  | StreamThreadEvent
  | GetVariablesEvent
  | GetVariablesResultEvent
  | CreateVariableEvent
  | CreateVariableResultEvent
  | DeleteVariableEvent
  | DeleteVariableResultEvent
  | PatchChannelStateEvent
  | PatchChannelStateResultEvent
  | PatchThreadStateEvent
  | PatchThreadStateResultEvent
  | PatchChannelDetailsEvent
  | PatchChannelDetailsResultEvent
  | PatchThreadDetailsEvent
  | PatchThreadDetailsResultEvent
  | ListFilesEvent
  | ListFilesResultEvent
  | ReadFileEvent
  | ReadFileResultEvent
  | CreateThreadEvent
  | CreateThreadResultEvent
  | CreateChannelEvent
  | CreateChannelResultEvent
  | UpdateChannelEvent
  | UpdateChannelResultEvent
  | UIWidgetEvent
  | RenderUIWidgetEvent
  | UIWidgetResponseEvent
  | HandoffEvent
  | HandoffResultEvent
  | HandoffRequestEvent
  | MCPListToolsEvent
  | MCPListToolsResultEvent
  | MCPCallEvent
  | MCPCallResultEvent
  | ShellExecEvent
  | ShellExecResultEvent
  | InstallPluginEvent
  | InstallPluginResultEvent
  | UninstallPluginEvent
  | UninstallPluginResultEvent
  | ListMarketplaceAgentsEvent
  | ListMarketplaceAgentsResultEvent
  | InstallAgentEvent
  | InstallAgentResultEvent
  | RememberEvent
  | RememberResultEvent
  | RecallEvent
  | RecallResultEvent
  | ForgetEvent
  | ForgetResultEvent
  | TodoWriteEvent
  | TodoWriteResultEvent
  | TodoUpdateEvent
  | TodoUpdateResultEvent;
