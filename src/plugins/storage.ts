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
  cwd?: string;
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
  cwd?: string;
  threads?: Thread[];
};

export interface Storage {
  getChannels: () => Promise<Channel[]>;
  createChannel: ({
    channelId,
    spec,
    initialState,
    cwd,
  }: {
    channelId: string;
    spec?: string;
    initialState?: Record<string, unknown>;
    cwd?: string;
  }) => Promise<void>;
  createThread: ({
    channelId,
    threadId,
    threadTitle,
    spec,
    initialState,
  }: {
    channelId: string;
    threadId: string;
    threadTitle?: string;
    spec?: string;
    initialState?: Record<string, unknown>;
  }) => Promise<void>;
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
  getVariables: () => Promise<Record<string, string | { value: string; secret: boolean }>>;
  listFiles: (options: {
    channelId: string;
    path?: string;
  }) => Promise<Array<{ name: string; isDirectory: boolean }>>;
  readFile: (options: { channelId: string; path: string }) => Promise<string>;
}

export interface StoragePluginOptions {
  storage: Storage;
}

export const storageToolDefinitions = {
  create_channel: {
    description:
      'Create a new channel. Use this when you think the user intent is completelly different from the current channel and should be split into multiple channels. Before creating, always notify with details and ask for confirmation. If user asks basic questions, no need to create a channel.',
    inputSchema: z.object({
      channelId: z
        .string()
        .describe(
          'Unique channel ID. Example: product-launch, backend-platform, or channel_roadmap.',
        ),
      spec: z
        .string()
        .optional()
        .describe('Optional initial markdown content for the channel spec.'),
      initialState: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Optional initial state object for the channel.'),
      cwd: z
        .string()
        .optional()
        .describe('Optional initial current working directory for the channel.'),
    }),
  },
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
        cwd: z.string().optional().describe('Current working directory for the channel.'),
      })
      .refine(
        (value) => value.state !== undefined || value.spec !== undefined || value.cwd !== undefined,
        {
          message: 'Provide at least one of state, spec, or cwd.',
        },
      ),
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

    builder.on('action:create_thread', async function* (event, context) {
      // We take threadId from meta so the next agent:invoke event will reply in the same thread.
      const threadId = event.meta?.threadId;
      const channelId = context.state.channelId;
      const { threadTitle, spec, initialState } = (event as any).data;

      if (!threadId) {
        console.warn('[storage] Cannot create thread: meta.threadId is missing');
        return;
      }

      // Override threadId in state to keep subsequent replies in the same thread.
      context.state.threadId = threadId;

      if (channelId) {
        try {
          await storage.createThread({
            channelId,
            threadId,
            threadTitle,
            spec,
            initialState: (initialState as Record<string, unknown>) || {},
          });

          context.state.threadDetails = await storage.getThreadDetails({
            channelId,
            threadId,
          });
        } catch (error) {
          console.warn(
            `[storage] Failed to initialize thread for channel ${channelId} thread ${threadId}`,
            error,
          );
        }
      }

      yield {
        type: 'action:create_thread:result',
        data: {
          success: true,
          threadId,
          threadTitle,
        },
        meta: {
          threadId,
        },
      } as any;
    });

    builder.on('action:create_channel', async function* (event, context) {
      const { channelId, spec, initialState, cwd } = (event as any).data;
      const rawChannelId = (channelId || '').trim();
      const channelSpec = typeof spec === 'string' ? spec : '';

      if (!rawChannelId) {
        yield {
          type: 'action:create_channel:result',
          data: {
            success: false,
            channelId: '',
            channelUrl: '',
          },
        } as any;
        return;
      }

      const channelUrl = `/channels/${rawChannelId}`;

      try {
        await storage.createChannel({
          channelId: rawChannelId,
          spec: channelSpec,
          initialState: initialState as Record<string, unknown>,
          cwd,
        });

        yield {
          type: 'action:create_channel:result',
          data: {
            success: true,
            channelId: rawChannelId,
            channelUrl,
          },
        } as any;

        yield {
          type: 'agent:output',
          data: {
            content: `Created channel \`${rawChannelId}\`.`,
          },
          meta: {
            ...(event.meta || {}),
            agentId: context.state.agentId,
          },
        } as any;
      } catch {
        yield {
          type: 'action:create_channel:result',
          data: {
            success: false,
            channelId: rawChannelId,
            channelUrl,
          },
        } as any;
      }
    });

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
      const maskedVariables: Record<string, string> = {};

      for (const [key, val] of Object.entries(variables)) {
        if (typeof val === 'object' && val !== null && val.secret) {
          maskedVariables[key] = '********';
        } else {
          maskedVariables[key] = typeof val === 'string' ? val : val.value;
        }
      }

      yield {
        type: 'action:storage:get-variables-result',
        data: { variables: maskedVariables },
      } as any;
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
      const updatedFields: ('state' | 'spec' | 'cwd')[] = [];

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

        if (typeof (event.data as any).cwd === 'string') {
          await storage.patchChannelState({
            channelId: context.state.channelId,
            state: { cwd: (event.data as any).cwd },
          });
          updatedFields.push('cwd');
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

    // Backward-compatible event used by external frontends.
    builder.on('action:update_channel', async function* (event, context) {
      const data = (event.data || {}) as {
        channelId?: string;
        name?: string;
        cwd?: string;
      };
      const targetChannelId = (data.channelId || context.state.channelId || '').trim();

      if (!targetChannelId) {
        yield {
          type: 'action:update_channel:result',
          data: {
            success: false,
            channelId: '',
            updatedFields: [] as string[],
          },
        } as any;
        return;
      }

      const patch: Record<string, unknown> = {};
      const updatedFields: string[] = [];

      if (typeof data.name === 'string' && data.name.trim()) {
        patch.name = data.name.trim();
        updatedFields.push('name');
      }

      if (typeof data.cwd === 'string' && data.cwd.trim()) {
        patch.cwd = data.cwd.trim();
        updatedFields.push('cwd');
      }

      try {
        if (updatedFields.length > 0) {
          await storage.patchChannelState({
            channelId: targetChannelId,
            state: patch,
          });
        }

        if (targetChannelId === context.state.channelId) {
          context.state.channelDetails = await storage.getChannelDetails({
            channelId: context.state.channelId,
          });
        }

        yield {
          type: 'action:update_channel:result',
          data: {
            success: true,
            channelId: targetChannelId,
            updatedFields,
          },
        } as any;
      } catch {
        yield {
          type: 'action:update_channel:result',
          data: {
            success: false,
            channelId: targetChannelId,
            updatedFields,
          },
        } as any;
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
          meta: {
            agentId: context.state.agentId,
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
          meta: {
            agentId: context.state.agentId,
          },
        };
      }
    });

    builder.on('action:storage:list-files', async function* (event, context) {
      const channelId = context.state.channelId;
      const subPath = (event.data as any)?.path || '';

      try {
        const files = await storage.listFiles({ channelId, path: subPath });
        yield {
          type: 'action:storage:list-files:result',
          data: {
            success: true,
            files,
          },
        };
      } catch (error) {
        yield {
          type: 'action:storage:list-files:result',
          data: {
            success: false,
            files: [],
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    });

    builder.on('action:storage:read-file', async function* (event, context) {
      const channelId = context.state.channelId;
      const filePath = (event.data as any)?.path;

      if (!filePath) {
        yield {
          type: 'action:storage:read-file:result',
          data: {
            success: false,
            path: '',
            error: 'Path is required',
          },
        };
        return;
      }

      try {
        const content = await storage.readFile({ channelId, path: filePath });
        yield {
          type: 'action:storage:read-file:result',
          data: {
            success: true,
            content,
            path: filePath,
          },
        };
      } catch (error) {
        yield {
          type: 'action:storage:read-file:result',
          data: {
            success: false,
            path: filePath,
            error: error instanceof Error ? error.message : 'Unknown error',
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
