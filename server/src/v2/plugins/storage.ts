import { MelonyPlugin } from 'melony';
import { OpenBotState, OpenBotEvent } from '../app/types.js';
import { storageService } from '../services/storage.js';
import z from 'zod';

export type PluginKind = 'runtime' | 'tool';

export type PluginMetadata = {
  name: string;
  description: string;
  kind?: PluginKind;
  factory: (config?: any) => MelonyPlugin<any, any>;
  toolDefinitions?: Record<string, any>;
  [key: string]: any;
};

export type Agent = {
  id: string;
  name: string;
  description: string;
  image?: string;
  runtime?: string | { name: string; config?: any };
  createdAt: Date;
  updatedAt: Date;
};

export type AgentDetails = Agent & {
  instructions: string;
  runtime?: string | { name: string; config?: any };
  plugins?: (string | { name: string; config?: any })[];
};

export type Plugin = {
  id: string;
  name: string;
  description: string;
  image?: string;
  kind: PluginKind;
  createdAt: Date;
  updatedAt: Date;
};

export type Channel = {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  /** Indicates if there are messages the user hasn't fetched via get-events yet. */
  hasUnseenMessages?: boolean;
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
  createChannel: ({ channelId, spec }: { channelId: string; spec?: string }) => Promise<void>;
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
  getEvents: ({
    channelId,
    threadId,
  }: {
    channelId: string;
    threadId?: string;
  }) => Promise<OpenBotEvent[]>;
  getChannelDetails: ({ channelId }: { channelId: string }) => Promise<ChannelDetails>;
  patchChannelState: ({ channelId, state }: { channelId: string; state: unknown }) => Promise<void>;
  patchThreadState: ({
    channelId,
    threadId,
    state,
  }: {
    channelId: string;
    threadId: string;
    state: unknown;
  }) => Promise<void>;
  patchChannelSpec: ({ channelId, spec }: { channelId: string; spec: string }) => Promise<void>;
  patchThreadSpec: ({
    channelId,
    threadId,
    spec,
  }: {
    channelId: string;
    threadId: string;
    spec: string;
  }) => Promise<void>;
  getVariables: () => Promise<Record<string, string>>;
}

export interface StoragePluginOptions {
  storage: Storage;
}

export const storageToolDefinitions = {
  patch_channel_details: {
    description: 'Patch current channel details (state and/or spec).',
    inputSchema: z
      .object({
        state: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'JSON state object for the channel. Use this for structured data like `todos` or metadata.',
          ),
        spec: z
          .string()
          .optional()
          .describe(
            'Markdown content for the channel specification (SPEC.md). Use this for goals and rules.',
          ),
      })
      .refine((value) => value.state !== undefined || value.spec !== undefined, {
        message: 'Provide at least one of state or spec.',
      }),
  },
  patch_thread_details: {
    description: 'Patch current thread details (state and/or spec).',
    inputSchema: z
      .object({
        state: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'JSON state object for the thread. Use this for structured data like `todos` or progress tracking.',
          ),
        spec: z
          .string()
          .optional()
          .describe(
            'Markdown content for the thread specification (SPEC.md). Use this for detailed plans and goals.',
          ),
      })
      .refine((value) => value.state !== undefined || value.spec !== undefined, {
        message: 'Provide at least one of state or spec.',
      }),
  },
};

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

      // Simple: fetching main channel events marks it as read
      if (!state.state.threadId && events.length > 0) {
        const lastId = events[events.length - 1]?.id;
        if (lastId) {
          // We call storageService directly as it's an internal helper now
          await storageService.setLastReadForChannel({
            channelId: state.state.channelId,
            lastReadEventId: lastId,
          });
        }
      }

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

    builder.on('action:patch_channel_details', async function* (event, context) {
      const updatedFields: ('state' | 'spec')[] = [];

      try {
        if ((event.data as any).state !== undefined) {
          await storage.patchChannelState({
            channelId: context.state.channelId,
            state: (event.data as any).state,
          });
          updatedFields.push('state');
        }

        if (typeof (event.data as any).spec === 'string') {
          await storage.patchChannelSpec({
            channelId: context.state.channelId,
            spec: (event.data as any).spec,
          });
          updatedFields.push('spec');
        }

        context.state.channelDetails = await storage.getChannelDetails({
          channelId: context.state.channelId,
        });

        yield {
          type: 'action:patch_channel_details:result',
          data: {
            success: true,
            updatedFields,
          },
        };
      } catch (error) {
        yield {
          type: 'action:patch_channel_details:result',
          data: {
            success: false,
            updatedFields,
          },
        };
      }
    });

    builder.on('action:patch_thread_details', async function* (event, context) {
      const updatedFields: ('state' | 'spec')[] = [];

      try {
        if (!context.state.threadId) {
          throw new Error('Missing threadId in state for patch_thread_details');
        }

        if ((event.data as any).state !== undefined) {
          await storage.patchThreadState({
            channelId: context.state.channelId,
            threadId: context.state.threadId,
            state: (event.data as any).state,
          });
          updatedFields.push('state');
        }

        if (typeof (event.data as any).spec === 'string') {
          await storage.patchThreadSpec({
            channelId: context.state.channelId,
            threadId: context.state.threadId,
            spec: (event.data as any).spec,
          });
          updatedFields.push('spec');
        }

        context.state.threadDetails = await storage.getThreadDetails({
          channelId: context.state.channelId,
          threadId: context.state.threadId,
        });

        yield {
          type: 'action:patch_thread_details:result',
          data: {
            success: true,
            updatedFields,
          },
        };

        yield {
          type: 'agent:output',
          data: {
            content: `Thread details updated: ${updatedFields.join(', ')}`,
          },
        };
      } catch (error) {
        yield {
          type: 'action:patch_thread_details:result',
          data: {
            success: false,
            updatedFields,
          },
        };

        yield {
          type: 'agent:output',
          data: {
            content: `Failed to update thread details: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        };
      }
    });
  };

export const plugin = {
  name: 'storage',
  description: 'Built-in storage plugin',
  factory: storagePlugin,
  toolDefinitions: storageToolDefinitions,
};
