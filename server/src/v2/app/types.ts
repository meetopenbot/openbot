import { Agent, AgentDetails, Channel, ChannelDetails, Plugin, Thread } from '../plugins/storage.js';

export interface OpenBotState {
  agentId: string;
  runId: string;
  channelId: string;
  threadId?: string;
  agentDetails?: AgentDetails;
  channelDetails?: ChannelDetails;
}

export type BaseEvent = {
  id?: string;
  type: string;
};

export type AgentInvokeEvent = BaseEvent & {
  type: 'agent:invoke';
  data: {
    content: string;
    agentId?: string;
  };
};

export type UIMessageEvent = BaseEvent & {
  type: 'client:ui:message';
  data: {
    content: string;
    role: 'user' | 'assistant';
  };
  meta: {
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
    variables: Record<string, string>;
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

export type AgentOutputEvent = BaseEvent & {
  type: 'agent:output';
  data: {
    content: string;
  };
};

export type OpenBotEvent =
  | AgentInvokeEvent
  | UIMessageEvent
  | AgentOutputEvent
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
  | PatchChannelStateEvent
  | PatchChannelStateResultEvent;
