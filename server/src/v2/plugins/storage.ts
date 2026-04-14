import { MelonyPlugin } from 'melony';
import { OpenBotState, OpenBotEvent } from '../app/types.js';

export type Agent = {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentDetails = Agent & {
  instructions: string;
};

export type Plugin = {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
};

export type Channel = {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ChannelDetails = {
  id: string;
  name: string;
  spec: string;
  state: unknown;
};

export interface Storage {
  getChannels: () => Promise<Channel[]>;
  getAgents: () => Promise<Agent[]>;
  getPlugins: () => Promise<Plugin[]>;
  getAgentDetails: ({ agentId }: { agentId: string }) => Promise<AgentDetails>;
  getEvents: ({ threadId }: { threadId: string }) => Promise<OpenBotEvent[]>;
  getChannelDetails: ({ threadId }: { threadId: string }) => Promise<ChannelDetails>;
  getVariables: () => Promise<Record<string, string>>;
}

export interface StoragePluginOptions {
  storage: Storage;
}

export const storagePlugin =
  (options: StoragePluginOptions): MelonyPlugin<OpenBotState, OpenBotEvent> =>
  (builder) => {
    const { storage } = options;

    builder.on('plugin:storage:get-channels', async function* () {
      const channels = await storage.getChannels();
      yield {
        type: 'plugin:storage:get-channels-result',
        data: { channels },
      };
    });

    builder.on('plugin:storage:get-channel-details', async function* (_, state) {
      const channelDetails = await storage.getChannelDetails(state.state);
      yield {
        type: 'plugin:storage:get-channel-details-result',
        data: { channelDetails },
      };
    });

    builder.on('plugin:storage:get-agents', async function* () {
      const agents = await storage.getAgents();
      yield {
        type: 'plugin:storage:get-agents-result',
        data: { agents },
      };
    });

    builder.on('plugin:storage:get-plugins' as OpenBotEvent['type'], async function* () {
      const plugins = await storage.getPlugins();
      yield {
        type: 'plugin:storage:get-plugins-result',
        data: { plugins },
      };
    });

    builder.on('plugin:storage:get-agent-details', async function* (_, state) {
      const agentDetails = await storage.getAgentDetails(state.state);
      yield {
        type: 'plugin:storage:get-agent-details-result',
        data: { agentDetails },
      };
    });

    builder.on('plugin:storage:get-events', async function* (_, state) {
      const events = await storage.getEvents(state.state);
      yield {
        type: 'plugin:storage:get-events-result',
        data: { events },
      };
    });

    builder.on('plugin:storage:get-variables', async function* () {
      const variables = await storage.getVariables();
      yield {
        type: 'plugin:storage:get-variables-result',
        data: { variables },
      };
    });
  };
