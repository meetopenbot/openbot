import {
  Agent,
  AgentDetails,
  Channel,
  ChannelDetails,
  Plugin,
  Thread,
  ThreadDetails,
} from '../plugins/storage.js';

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

export type ShortTermMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

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
    plugins: Plugin[];
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
    spec?: string;
  };
};

export type PatchThreadDetailsResultEvent = BaseEvent & {
  type: 'action:patch_thread_details:result';
  data: {
    success: boolean;
    updatedFields: ('state' | 'spec')[];
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

export type ActiveRunsSnapshotEvent = BaseEvent & {
  type: 'agent:active-runs:snapshot';
  data: {
    channels: Array<{
      channelId: string;
      activeCount: number;
      agentIds: string[];
    }>;
  };
};

export type CreateThreadEvent = BaseEvent & {
  type: 'action:create_thread';
  data: {
    threadTitle: string;
    spec?: string;
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

export type DelegateEvent = BaseEvent & {
  type: 'action:delegate';
  data: {
    agentId: string;
    content: string;
  };
  meta: {
    toolCallId: string;
  };
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

export type OpenBotEvent =
  | UserInputEvent
  | AgentInvokeEvent
  | AgentOutputEvent
  | AgentRunStartEvent
  | AgentRunEndEvent
  | ActiveRunsSnapshotEvent
  | GetChannelsEvent
  | GetChannelsResultEvent
  | GetThreadsEvent
  | GetThreadsResultEvent
  | GetChannelDetailsEvent
  | GetChannelDetailsResultEvent
  | GetAgentsEvent
  | GetAgentsResultEvent
  | GetPluginsEvent
  | GetPluginsResultEvent
  | GetAgentDetailsEvent
  | GetAgentDetailsResultEvent
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
  | DelegateEvent
  | MCPListToolsEvent
  | MCPListToolsResultEvent
  | MCPCallEvent
  | MCPCallResultEvent
  | InstallPluginEvent
  | InstallPluginResultEvent
  | UninstallPluginEvent
  | UninstallPluginResultEvent;
