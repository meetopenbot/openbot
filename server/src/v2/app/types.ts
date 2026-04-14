import { Agent, AgentDetails, Channel, ChannelDetails, Plugin } from '../plugins/storage.js';

export interface OpenBotState {
  agentId: string;
  runId: string;
  threadId: string;
}

export type BaseEvent = {
  type: string;
};

export type UserInputEvent = BaseEvent & {
  type: 'user:input';
  data: {
    content: string;
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

export type AISDKInputEvent = BaseEvent & {
  type: 'plugin:ai-sdk:input';
  data: {
    content: string;
  };
};

export type AISDKOutputEvent = BaseEvent & {
  type: 'plugin:ai-sdk:output';
  data: {
    content: string;
  };
};

export type GetChannelsEvent = BaseEvent & {
  type: 'plugin:storage:get-channels';
};

export type GetChannelsResultEvent = BaseEvent & {
  type: 'plugin:storage:get-channels-result';
  data: {
    channels: Channel[];
  };
};

export type GetChannelDetailsEvent = BaseEvent & {
  type: 'plugin:storage:get-channel-details';
};

export type GetChannelDetailsResultEvent = BaseEvent & {
  type: 'plugin:storage:get-channel-details-result';
  data: {
    channelDetails: ChannelDetails;
  };
};

export type GetAgentsEvent = BaseEvent & {
  type: 'plugin:storage:get-agents';
};

export type GetAgentsResultEvent = BaseEvent & {
  type: 'plugin:storage:get-agents-result';
  data: {
    agents: Agent[];
  };
};

export type GetPluginsEvent = BaseEvent & {
  type: 'plugin:storage:get-plugins';
};

export type GetPluginsResultEvent = BaseEvent & {
  type: 'plugin:storage:get-plugins-result';
  data: {
    plugins: Plugin[];
  };
};

export type GetEventsEvent = BaseEvent & {
  type: 'plugin:storage:get-events';
};

export type GetEventsResultEvent = BaseEvent & {
  type: 'plugin:storage:get-events-result';
  data: {
    events: OpenBotEvent[];
  };
};

export type GetAgentDetailsEvent = BaseEvent & {
  type: 'plugin:storage:get-agent-details';
};

export type GetAgentDetailsResultEvent = BaseEvent & {
  type: 'plugin:storage:get-agent-details-result';
  data: {
    agentDetails: AgentDetails;
  };
};

export type StreamThreadEvent = BaseEvent & {
  type: 'stream:thread';
  data: {
    threadId: string;
  };
};

export type GetVariablesEvent = BaseEvent & {
  type: 'plugin:storage:get-variables';
};

export type GetVariablesResultEvent = BaseEvent & {
  type: 'plugin:storage:get-variables-result';
  data: {
    variables: Record<string, string>;
  };
};

export type OpenBotEvent =
  | UserInputEvent
  | UIMessageEvent
  | AISDKInputEvent
  | AISDKOutputEvent
  | GetChannelsEvent
  | GetChannelsResultEvent
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
  | GetVariablesResultEvent;
