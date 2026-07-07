import {
  Agent,
  AgentDetails,
  Channel,
  ChannelDetails,
  PluginDescriptor,
  Thread,
  ThreadDetails,
} from '../services/plugins/domain.js';
import type { PluginRef } from '../services/plugins/types.js';

export interface MemoryRecord {
  id: string;
  scope: string;
  content: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OpenBotState {
  agentId: string;
  runId: string;
  channelId: string;
  threadId?: string;
  agentDetails?: AgentDetails;
  channelDetails?: ChannelDetails;
  threadDetails?: ThreadDetails;
  triggerEvent?: OpenBotEvent;
  /** Active model string (e.g. `openai/gpt-4o-mini`). */
  model?: string;
  /** Persisted tool call IDs waiting for results. */
  pendingToolCallIds?: string[];
  /** Current user information if available. */
  currentUser?: {
    userName?: string;
  };
}

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

export type SetLastReadEvent = BaseEvent & {
  type: 'action:storage:set-last-read';
  data: {
    channelId?: string;
    threadId?: string;
    lastReadEventId: string;
  };
};

export type SetLastReadResultEvent = BaseEvent & {
  type: 'action:storage:set-last-read-result';
  data: {
    success: boolean;
    error?: string;
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

export type GetActiveRunsEvent = BaseEvent & {
  type: 'action:storage:get-active-runs';
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
    image?: string;
    hidden?: boolean;
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
    image?: string;
    hidden?: boolean;
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
    encoding?: 'utf8' | 'base64';
  };
};

export type ReadFileResultEvent = BaseEvent & {
  type: 'action:storage:read-file:result';
  data: {
    success: boolean;
    content?: string;
    path: string;
    encoding?: 'utf8' | 'base64';
    mimeType?: string;
    size?: number;
    error?: string;
  };
};

export type ServeFileEvent = BaseEvent & {
  type: 'action:storage:serve-file';
  data: {
    path: string;
  };
};

export type WriteFileEvent = BaseEvent & {
  type: 'action:storage:write-file';
  data: {
    path: string;
    content: string;
    encoding?: 'utf8' | 'base64';
    overwrite?: boolean;
  };
};

export type WriteFileResultEvent = BaseEvent & {
  type: 'action:storage:write-file:result';
  data: {
    success: boolean;
    path: string;
    url?: string;
    mimeType?: string;
    size?: number;
    error?: string;
  };
};

export type GetFileUrlEvent = BaseEvent & {
  type: 'action:storage:get-file-url';
  data: {
    path: string;
  };
};

export type GetFileUrlResultEvent = BaseEvent & {
  type: 'action:storage:get-file-url:result';
  data: {
    success: boolean;
    path: string;
    url?: string;
    mimeType?: string;
    size?: number;
    error?: string;
  };
};

export type GetWorkspaceFileUrlEvent = BaseEvent & {
  type: 'action:get_workspace_file_url';
  data: {
    path: string;
  };
  meta?: {
    toolCallId?: string;
    agentId?: string;
    threadId?: string;
  };
};

export type GetWorkspaceFileUrlResultEvent = BaseEvent & {
  type: 'action:get_workspace_file_url:result';
  data: {
    success: boolean;
    path: string;
    url?: string;
    mimeType?: string;
    size?: number;
    output?: string;
    error?: string;
  };
  meta?: {
    toolCallId?: string;
    agentId?: string;
    threadId?: string;
  };
};

export type UploadFileEvent = BaseEvent & {
  type: 'action:storage:upload-file';
  data: {
    path: string;
    overwrite?: boolean;
  };
};

export type UploadFileResultEvent = BaseEvent & {
  type: 'action:storage:upload-file:result';
  data: {
    success: boolean;
    path: string;
    url?: string;
    mimeType?: string;
    size?: number;
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

export type DeleteChannelEvent = BaseEvent & {
  type: 'action:storage:delete-channel';
  data: {
    channelId: string;
  };
};

export type DeleteChannelResultEvent = BaseEvent & {
  type: 'action:storage:delete-channel-result';
  data: {
    success: boolean;
    error?: string;
  };
};

export type DeleteChannelToolEvent = BaseEvent & {
  type: 'action:delete_channel';
  data: {
    channelId: string;
  };
  meta?: {
    toolCallId?: string;
    agentId?: string;
    threadId?: string;
  };
};

export type DeleteChannelToolResultEvent = BaseEvent & {
  type: 'action:delete_channel:result';
  data: {
    success: boolean;
    channelId: string;
    error?: string;
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
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'multiselect' | 'date' | 'password';
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

export type UIMediaItem = {
  type: 'image' | 'video' | 'audio' | 'file';
  url: string;
  title?: string;
  alt?: string;
  thumbnailUrl?: string;
  metadata?: Record<string, unknown>;
};

export type UIWidgetBase = {
  widgetId: string;
  title?: string;
  description?: string;
  /** Optional hero media for the widget */
  media?: UIMediaItem;
  /** Optional actions for the widget */
  actions?: UIWidgetAction[];
  state?: 'open' | 'submitted' | 'cancelled' | 'error';
  display?: 'expanded' | 'collapsed';
  size?: 'small' | 'medium' | 'large' | 'full';
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

export type UIWidgetEvent = BaseEvent & {
  type: 'client:ui:widget';
  data: UIWidgetSpec;
  meta: {
    agentId: string;
    threadId?: string;
  };
};

export type UIWidgetResponseEvent = BaseEvent & {
  type: 'client:ui:widget:response';
  data: {
    widgetId: string;
    actionId: string;
    values?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  meta?: {
    agentId?: string;
    threadId?: string;
    [key: string]: unknown;
  };
};

export type ShellExecEvent = BaseEvent & {
  type: 'action:shell_exec';
  data: {
    id: string;
    exec_dir: string;
    command: string;
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
    exitCode?: number;
    error?: string;
    output?: string;
  };
};

export type ShellViewEvent = BaseEvent & {
  type: 'action:shell_view';
  data: {
    id: string;
  };
};

export type ShellViewResultEvent = BaseEvent & {
  type: 'action:shell_view:result';
  data: {
    success: boolean;
    output?: string;
  };
};

export type ShellWaitEvent = BaseEvent & {
  type: 'action:shell_wait';
  data: {
    id: string;
    seconds: number;
  };
};

export type ShellWaitResultEvent = BaseEvent & {
  type: 'action:shell_wait:result';
  data: {
    success: boolean;
    waitedSeconds?: number;
    output?: string;
  };
};

export type ShellWriteToProcessEvent = BaseEvent & {
  type: 'action:shell_write_to_process';
  data: {
    id: string;
    input: string;
    press_enter: boolean;
  };
};

export type ShellWriteToProcessResultEvent = BaseEvent & {
  type: 'action:shell_write_to_process:result';
  data: {
    success: boolean;
    output?: string;
  };
};

export type ShellKillProcessEvent = BaseEvent & {
  type: 'action:shell_kill_process';
  data: {
    id: string;
  };
};

export type ShellKillProcessResultEvent = BaseEvent & {
  type: 'action:shell_kill_process:result';
  data: {
    success: boolean;
    output?: string;
  };
};

export type ExposePortEvent = BaseEvent & {
  type: 'action:expose_port';
  data: {
    port: number;
  };
  meta?: {
    toolCallId?: string;
    approvalId?: string;
    approvalStatus?: 'approved' | 'denied';
    [key: string]: unknown;
  };
};

export type ExposePortResultEvent = BaseEvent & {
  type: 'action:expose_port:result';
  data: {
    success: boolean;
    previewUrl?: string;
    port?: number;
    temporary?: boolean;
    error?: string;
    output?: string;
  };
};

export type UnexposePortEvent = BaseEvent & {
  type: 'action:unexpose_port';
  data?: Record<string, never>;
};

export type UnexposePortResultEvent = BaseEvent & {
  type: 'action:unexpose_port:result';
  data: {
    success: boolean;
    output?: string;
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

export type ListMarketplaceRegistryEvent = BaseEvent & {
  type: 'action:marketplace:list';
};

export type ListMarketplaceRegistryResultEvent = BaseEvent & {
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
    channels: Array<{
      id: string;
      name: string;
      description: string;
      image?: string;
      spec?: string;
      initialState?: Record<string, unknown>;
      starterPrompts?: Array<{ label: string; prompt: string }>;
    }>;
    error?: string;
  };
};

export type InstallChannelEvent = BaseEvent & {
  type: 'action:channel:install';
  data: {
    channelId: string;
    name?: string;
    initialState?: Record<string, unknown>;
  };
};

export type InstallChannelResultEvent = BaseEvent & {
  type: 'action:channel:install:result';
  data: {
    success: boolean;
    channelId?: string;
    channelUrl?: string;
    error?: string;
  };
};

export type InstallAgentEvent = BaseEvent & {
  type: 'action:agent:install';
  data: {
    agentId: string;
    name: string;
    description?: string;
    image?: string;
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

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type AgentUsageEvent = BaseEvent & {
  type: 'agent:usage';
  data: {
    usage: Usage;
    model?: string;
  };
  meta: {
    agentId: string;
    threadId?: string;
    runId?: string;
  };
};

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

export type DelegateTaskEvent = BaseEvent & {
  type: 'action:delegate_task';
  data: {
    agentId: string;
    prompt: string;
  };
};

export type DelegateTaskResultEvent = BaseEvent & {
  type: 'action:delegate_task:result';
  data: {
    success: boolean;
    output?: string;
    error?: string;
  };
};

export type RenderWidgetEvent = BaseEvent & {
  type: 'action:render_widget';
  data: {
    kind: 'message' | 'choice' | 'form' | 'list';
    title: string;
    description?: string;
    fields?: UIWidgetField[];
    actions?: UIWidgetAction[];
    items?: UIWidgetListItem[];
    submitLabel?: string;
  };
  meta?: {
    toolCallId?: string;
    threadId?: string;
    [key: string]: any;
  };
};

export type RenderWidgetResultEvent = BaseEvent & {
  type: 'action:render_widget:result';
  data: {
    success: boolean;
    actionId: string;
    values?: Record<string, unknown>;
  };
};

/**
 * Internal message representation to decouple harness history from specific AI SDKs.
 */
export type OpenBotMessage =
  | { role: 'user'; content: string | OpenBotMessagePart[] }
  | { role: 'assistant'; content: string | OpenBotMessagePart[] }
  | { role: 'system'; content: string }
  | { role: 'tool'; content: OpenBotMessagePart[] };

export type OpenBotMessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: any }
  | { type: 'tool-result'; toolCallId: string; toolName: string; output: any };

export type OpenBotEvent =
  | AgentInvokeEvent
  | AgentOutputEvent
  | AgentUsageEvent
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
  | SetLastReadEvent
  | SetLastReadResultEvent
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
  | GetActiveRunsEvent
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
  | ServeFileEvent
  | WriteFileEvent
  | WriteFileResultEvent
  | GetFileUrlEvent
  | GetFileUrlResultEvent
  | GetWorkspaceFileUrlEvent
  | GetWorkspaceFileUrlResultEvent
  | UploadFileEvent
  | UploadFileResultEvent
  | CreateThreadEvent
  | CreateThreadResultEvent
  | CreateChannelEvent
  | CreateChannelResultEvent
  | UpdateChannelEvent
  | UpdateChannelResultEvent
  | DeleteChannelEvent
  | DeleteChannelResultEvent
  | DeleteChannelToolEvent
  | DeleteChannelToolResultEvent
  | UIWidgetEvent
  | UIWidgetResponseEvent
  | ShellExecEvent
  | ShellExecResultEvent
  | ShellViewEvent
  | ShellViewResultEvent
  | ShellWaitEvent
  | ShellWaitResultEvent
  | ShellWriteToProcessEvent
  | ShellWriteToProcessResultEvent
  | ShellKillProcessEvent
  | ShellKillProcessResultEvent
  | ExposePortEvent
  | ExposePortResultEvent
  | UnexposePortEvent
  | UnexposePortResultEvent
  | InstallPluginEvent
  | InstallPluginResultEvent
  | UninstallPluginEvent
  | UninstallPluginResultEvent
  | ListMarketplaceRegistryEvent
  | ListMarketplaceRegistryResultEvent
  | InstallAgentEvent
  | InstallAgentResultEvent
  | InstallChannelEvent
  | InstallChannelResultEvent
  | RememberEvent
  | RememberResultEvent
  | RecallEvent
  | RecallResultEvent
  | ForgetEvent
  | ForgetResultEvent
  | DelegateTaskEvent
  | DelegateTaskResultEvent
  | RenderWidgetEvent
  | RenderWidgetResultEvent;
