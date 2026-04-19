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
  plugins?: (string | { name: string; config?: any })[];
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
  recentThreads?: Thread[];
};

export type Thread = {
  id: string;
  name: string;
  channelId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ThreadDetails = {
  id: string;
  name: string;
  channelId: string;
  spec: string;
  state: unknown;
};

export type ChannelDetails = {
  id: string;
  name: string;
  spec: string;
  state: unknown;
  threads?: Thread[];
};

export interface Storage {
  getChannels: () => Promise<Channel[]>;
  getThreads: ({ channelId }: { channelId: string }) => Promise<Thread[]>;
  getThreadDetails: ({
    channelId,
    threadId,
  }: {
    channelId: string;
    threadId: string;
  }) => Promise<ThreadDetails>;
  getAgents: () => Promise<Agent[]>;
  getPlugins: () => Promise<Plugin[]>;
  getAgentDetails: ({ agentId }: { agentId: string }) => Promise<AgentDetails>;
  getEvents: ({ channelId, threadId }: { channelId: string; threadId?: string }) => Promise<OpenBotEvent[]>;
  getChannelDetails: ({ channelId }: { channelId: string }) => Promise<ChannelDetails>;
  patchChannelState: ({
    channelId,
    state,
  }: {
    channelId: string;
    state: unknown;
  }) => Promise<void>;
  patchThreadState: ({
    channelId,
    threadId,
    state,
  }: {
    channelId: string;
    threadId: string;
    state: unknown;
  }) => Promise<void>;
  getVariables: () => Promise<Record<string, string>>;
}

export interface StoragePluginOptions {
  storage: Storage;
}

export const storagePlugin =
  (options: StoragePluginOptions): MelonyPlugin<OpenBotState, OpenBotEvent> =>
  (builder) => {
    const { storage } = options;

    builder.on('action:storage:get-channels', async function* () {
      const channels = await storage.getChannels();
      yield {
        type: 'action:storage:get-channels-result',
        data: { channels },
      };
    });

    builder.on('action:storage:get-threads', async function* (event) {
      const threads = await storage.getThreads({ channelId: event.data.channelId });
      yield {
        type: 'action:storage:get-threads-result',
        data: { threads },
      };
    });

    builder.on('action:storage:get-channel-details', async function* (_, state) {
      const channelDetails = await storage.getChannelDetails({ channelId: state.state.channelId });
      yield {
        type: 'action:storage:get-channel-details-result',
        data: { channelDetails },
      };
    });

    builder.on('action:storage:get-agents', async function* () {
      const agents = await storage.getAgents();
      yield {
        type: 'action:storage:get-agents-result',
        data: { agents },
      };
    });

    builder.on('action:storage:get-plugins' as OpenBotEvent['type'], async function* () {
      const plugins = await storage.getPlugins();
      yield {
        type: 'action:storage:get-plugins-result',
        data: { plugins },
      };
    });

    builder.on('action:storage:get-agent-details', async function* (event, state) {
      const agentDetails = await storage.getAgentDetails({ agentId: event.data.agentId });
      yield {
        type: 'action:storage:get-agent-details-result',
        data: { agentDetails },
      };
    });

    builder.on('action:storage:get-events', async function* (_, state) {
      const events = await storage.getEvents(state.state);
      yield {
        type: 'action:storage:get-events-result',
        data: { events },
      };
    });

    builder.on('action:storage:get-variables', async function* () {
      const variables = await storage.getVariables();
      yield {
        type: 'action:storage:get-variables-result',
        data: { variables },
      };
    });

    builder.on('action:storage:patch-channel-state', async function* (event, state) {
      try {
        await storage.patchChannelState({
          channelId: state.state.channelId,
          state: event.data.state,
        });
        yield {
          type: 'action:storage:patch-channel-state-result',
          data: { success: true },
        };
      } catch (error) {
        yield {
          type: 'action:storage:patch-channel-state-result',
          data: { success: false },
        };
      }
    });

    builder.on('action:storage:patch-thread-state', async function* (event, state) {
      try {
        if (!state.state.threadId) {
          throw new Error('Missing threadId in state for patch-thread-state');
        }

        await storage.patchThreadState({
          channelId: state.state.channelId,
          threadId: state.state.threadId,
          state: event.data.state,
        });
        yield {
          type: 'action:storage:patch-thread-state-result',
          data: { success: true },
        };
      } catch (error) {
        yield {
          type: 'action:storage:patch-thread-state-result',
          data: { success: false },
        };
      }
    });
  };
