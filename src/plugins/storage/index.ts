import z from 'zod';
import type { Plugin } from '../../services/plugins/types.js';
import { OpenBotEvent } from '../../app/types.js';

/**
 * `storage` — exposes channel/thread/variable mutation tools and provides
 * platform-level storage handlers.
 */
const storageToolDefinitions = {
  create_channel: {
    description:
      'Create a new channel. Use when the user intent is clearly different from the current channel and should be split. Always confirm before creating. Skip for simple Q&A.',
    inputSchema: z.object({
      channelId: z
        .string()
        .describe('Unique channel ID (e.g. product-launch, backend-platform, channel_roadmap).'),
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
        .describe(
          'Optional initial current working directory for the channel. Defaults to an absolute path under ~/openbot/{channelId}.',
        ),
    }),
  },
  patch_channel_details: {
    description: 'Patch current channel details (state, spec, cwd).',
    inputSchema: z
      .object({
        state: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'JSON state object for the channel. Use for structured metadata.',
          ),
        spec: z
          .string()
          .optional()
          .describe(
            'Markdown content for the channel specification (SPEC.md). Use for goals and rules.',
          ),
        cwd: z.string().optional().describe('Current working directory for the channel.'),
        participants: z
          .array(z.string())
          .optional()
          .describe(
            'List of agent IDs that are participants in this channel. When a user tags an agent (e.g. @agent-id), you should ensure they are added to this list if they are not already there.',
          ),
      })
      .refine(
        (value) =>
          value.state !== undefined ||
          value.spec !== undefined ||
          value.cwd !== undefined ||
          value.participants !== undefined,
        { message: 'Provide at least one of state, spec, cwd, or participants.' },
      ),
  },
  patch_thread_details: {
    description: 'Patch current thread details (state).',
    inputSchema: z.object({
      state: z
        .record(z.string(), z.unknown())
        .describe(
          'JSON state object for the thread. Use for structured progress or metadata.',
        ),
    }),
  },
  create_variable: {
    description: 'Create or update a variable in the workspace storage.',
    inputSchema: z.object({
      key: z.string().describe('The key of the variable.'),
      value: z.string().describe('The value of the variable.'),
      secret: z.boolean().optional().describe('Whether the variable is a secret.'),
    }),
  },
  delete_variable: {
    description: 'Delete a variable from the workspace storage.',
    inputSchema: z.object({
      key: z.string().describe('The key of the variable to delete.'),
    }),
  },
  delete_channel: {
    description:
      'Permanently delete a channel and all its threads and events. Always confirm with the user before deleting.',
    inputSchema: z.object({
      channelId: z.string().describe('The channel ID to delete.'),
    }),
  },
};

export const storagePlugin: Plugin = {
  id: 'storage',
  name: 'Storage',
  description: 'Tools for creating channels, patching state, and managing workspace variables.',
  toolDefinitions: storageToolDefinitions,
  factory: ({ storage }) => (builder) => {
    builder.on('action:create_thread', async function* (event, context) {
      const threadId = event.meta?.threadId;
      const channelId = context.state.channelId;
      const { threadTitle, initialState } = (event as any).data;

      if (!threadId) {
        console.warn('[storage] Cannot create thread: meta.threadId is missing');
        return;
      }

      context.state.threadId = threadId;

      if (channelId) {
        try {
          await storage.createThread({
            channelId,
            threadId,
            threadTitle,
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
        data: { success: true, threadId, threadTitle },
        meta: { ...(event.meta || {}), threadId, agentId: context.state.agentId },
      } as OpenBotEvent;
    });

    builder.on('action:create_channel', async function* (event, context) {
      const { channelId, spec, initialState, cwd, participants } = (event as any).data;
      const rawChannelId = (channelId || '').trim();
      const channelSpec = typeof spec === 'string' ? spec : '';

      const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };

      if (!rawChannelId) {
        yield {
          type: 'action:create_channel:result',
          data: { success: false, channelId: '', channelUrl: '' },
          meta: resultMeta,
        } as OpenBotEvent;
        return;
      }

      const channelUrl = `/channels/${rawChannelId}`;

      const mergedInitial: Record<string, unknown> = { ...(initialState || {}) };
      if (participants !== undefined) {
        const normalized = Array.isArray(participants)
          ? participants
            .filter((x: unknown): x is string => typeof x === 'string')
            .map((s: string) => s.trim())
            .filter(Boolean)
          : [];
        mergedInitial.participants = normalized;
      }

      try {
        await storage.createChannel({
          channelId: rawChannelId,
          spec: channelSpec,
          initialState: mergedInitial,
          cwd,
        });

        yield {
          type: 'action:create_channel:result',
          data: { success: true, channelId: rawChannelId, channelUrl },
          meta: resultMeta,
        } as OpenBotEvent;

        yield {
          type: 'agent:output',
          data: { content: `Created channel \`${rawChannelId}\`.` },
          meta: resultMeta,
        } as OpenBotEvent;
      } catch {
        yield {
          type: 'action:create_channel:result',
          data: { success: false, channelId: rawChannelId, channelUrl },
          meta: resultMeta,
        } as OpenBotEvent;
      }
    });

    builder.on('action:delete_channel', async function* (event, context) {
      const rawChannelId = ((event.data as { channelId?: string })?.channelId || '').trim();
      const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };

      if (!rawChannelId) {
        yield {
          type: 'action:delete_channel:result',
          data: { success: false, channelId: '', error: 'channelId is required' },
          meta: resultMeta,
        } as OpenBotEvent;
        return;
      }

      try {
        await storage.deleteChannel({ channelId: rawChannelId });
        yield {
          type: 'action:delete_channel:result',
          data: { success: true, channelId: rawChannelId },
          meta: resultMeta,
        } as OpenBotEvent;
        yield {
          type: 'agent:output',
          data: { content: `Deleted channel \`${rawChannelId}\`.` },
          meta: resultMeta,
        } as OpenBotEvent;
      } catch (error) {
        yield {
          type: 'action:delete_channel:result',
          data: {
            success: false,
            channelId: rawChannelId,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          meta: resultMeta,
        } as OpenBotEvent;
      }
    });

    builder.on('action:update_channel', async function* (event, context) {
      const data = (event.data || {}) as {
        channelId?: string;
        name?: string;
        cwd?: string;
        participants?: string[];
      };
      const targetChannelId = (data.channelId || context.state.channelId || '').trim();
      const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };

      if (!targetChannelId) {
        yield {
          type: 'action:update_channel:result',
          data: { success: false, channelId: '', updatedFields: [] as string[] },
          meta: resultMeta,
        } as OpenBotEvent;
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
      if (data.participants !== undefined) {
        if (Array.isArray(data.participants)) {
          patch.participants = data.participants
            .filter((x): x is string => typeof x === 'string')
            .map((s) => s.trim())
            .filter(Boolean);
        } else {
          patch.participants = [];
        }
        updatedFields.push('participants');
      }

      try {
        if (updatedFields.length > 0) {
          await storage.patchChannelState({ channelId: targetChannelId, state: patch });
        }

        if (targetChannelId === context.state.channelId) {
          context.state.channelDetails = await storage.getChannelDetails({
            channelId: context.state.channelId,
          });
        }

        yield {
          type: 'action:update_channel:result',
          data: { success: true, channelId: targetChannelId, updatedFields },
          meta: resultMeta,
        } as OpenBotEvent;
      } catch {
        yield {
          type: 'action:update_channel:result',
          data: { success: false, channelId: targetChannelId, updatedFields },
          meta: resultMeta,
        } as OpenBotEvent;
      }
    });

    builder.on('action:patch_channel_details', async function* (event, context) {
      const updatedFields: ('state' | 'spec' | 'cwd' | 'participants')[] = [];
      const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };
      const data = (event.data || {}) as {
        state?: Record<string, unknown>;
        spec?: string;
        cwd?: string;
        participants?: string[];
      };
      try {
        if (data.state !== undefined) {
          await storage.patchChannelState({
            channelId: context.state.channelId,
            state: data.state,
          });
          updatedFields.push('state');
        }
        if (typeof data.spec === 'string') {
          await storage.patchChannelSpec({
            channelId: context.state.channelId,
            spec: data.spec,
          });
          updatedFields.push('spec');
        }
        if (typeof data.cwd === 'string') {
          await storage.patchChannelState({
            channelId: context.state.channelId,
            state: { cwd: data.cwd },
          });
          updatedFields.push('cwd');
        }
        if (data.participants !== undefined) {
          const normalized = Array.isArray(data.participants)
            ? data.participants
              .filter((x): x is string => typeof x === 'string')
              .map((s) => s.trim())
              .filter(Boolean)
            : [];
          await storage.patchChannelState({
            channelId: context.state.channelId,
            state: { participants: normalized },
          });
          updatedFields.push('participants');
        }

        context.state.channelDetails = await storage.getChannelDetails({
          channelId: context.state.channelId,
        });

        yield {
          type: "client:ui:widget",
          data: {
            widgetId: "patch-channel-details-result" + Date.now(),
            kind: "message",
            title: "Channel details updated.",
            body: `The channel details have been updated. ${updatedFields.join(', ')}`,
            display: "collapsed",
          },
          meta: resultMeta,
        }

        yield {
          type: 'action:patch_channel_details:result',
          data: { success: true, updatedFields },
          meta: resultMeta,
        };
      } catch {
        yield {
          type: 'action:patch_channel_details:result',
          data: { success: false, updatedFields },
          meta: resultMeta,
        };
      }
    });

    builder.on('action:patch_thread_details', async function* (event, context) {
      const updatedFields: ('state')[] = [];
      const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };
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

        context.state.threadDetails = await storage.getThreadDetails({
          channelId: context.state.channelId,
          threadId: context.state.threadId,
        });

        yield {
          type: 'action:patch_thread_details:result',
          data: { success: true, updatedFields },
          meta: resultMeta,
        };
      } catch {
        yield {
          type: 'action:patch_thread_details:result',
          data: { success: false, updatedFields },
          meta: resultMeta,
        };
      }
    });

    builder.on('agent:usage', async function* (event, context) {
      const { usage } = event.data;
      if (!context.state.threadId) return;

      const currentState = (context.state.threadDetails?.state as Record<string, any>) || {};
      const currentUsage = currentState.usage || {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      const nextUsage = {
        promptTokens: (currentUsage.promptTokens || 0) + usage.promptTokens,
        completionTokens: (currentUsage.completionTokens || 0) + usage.completionTokens,
        totalTokens: (currentUsage.totalTokens || 0) + usage.totalTokens,
      };

      await storage.patchThreadState({
        channelId: context.state.channelId,
        threadId: context.state.threadId,
        state: { usage: nextUsage },
      });

      context.state.threadDetails = await storage.getThreadDetails({
        channelId: context.state.channelId,
        threadId: context.state.threadId,
      });
    });

    builder.on('action:storage:get-channels', async function* () {
      const channels = await storage.getChannels();
      yield { type: 'action:storage:get-channels-result', data: { channels } };
    });

    builder.on('action:storage:get-threads', async function* (event) {
      const threads = await storage.getThreads({ channelId: event.data.channelId });
      yield { type: 'action:storage:get-threads-result', data: { threads } };
    });

    builder.on('action:storage:get-channel-details', async function* (_, state) {
      const channelDetails = await storage.getChannelDetails({
        channelId: state.state.channelId,
      });
      yield { type: 'action:storage:get-channel-details-result', data: { channelDetails } };
    });

    builder.on('action:storage:get-thread-details', async function* (_, state) {
      const threadId = state.state.threadId;
      const threadDetails = threadId
        ? await storage.getThreadDetails({ channelId: state.state.channelId, threadId })
        : null;
      yield { type: 'action:storage:get-thread-details-result', data: { threadDetails } };
    });

    builder.on('action:storage:get-agents', async function* () {
      const agents = await storage.getAgents();
      yield { type: 'action:storage:get-agents-result', data: { agents } };
    });

    builder.on('action:storage:get-plugins', async function* () {
      const plugins = await storage.getPlugins();
      yield { type: 'action:storage:get-plugins-result', data: { plugins } };
    });

    builder.on('action:storage:get-agent-details', async function* (event) {
      try {
        const agentDetails = await storage.getAgentDetails({ agentId: event.data.agentId });
        yield { type: 'action:storage:get-agent-details-result', data: { agentDetails } };
      } catch (error) {
        console.error(`[storage] Failed to get agent details for ${event.data.agentId}`, error);
        yield {
          type: 'action:storage:get-agent-details-result',
          data: {
            agentDetails: null as any,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    });

    builder.on('action:storage:create-agent', async function* (event) {
      try {
        const { agentId, name, description, image, hidden, instructions, plugins } = event.data;
        await storage.createAgent({
          agentId,
          name,
          description,
          image,
          hidden,
          instructions,
          plugins,
        });
        yield { type: 'action:storage:create-agent-result', data: { success: true } };
      } catch (error) {
        yield {
          type: 'action:storage:create-agent-result',
          data: {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    });

    builder.on('action:storage:update-agent', async function* (event) {
      try {
        const { agentId, name, description, image, hidden, instructions, plugins } = event.data;
        await storage.updateAgent({
          agentId,
          name,
          description,
          image,
          hidden,
          instructions,
          plugins,
        });
        yield { type: 'action:storage:update-agent-result', data: { success: true } };
      } catch (error) {
        yield {
          type: 'action:storage:update-agent-result',
          data: {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    });

    builder.on('action:storage:delete-channel', async function* (event) {
      try {
        await storage.deleteChannel({ channelId: event.data.channelId });
        yield { type: 'action:storage:delete-channel-result', data: { success: true } };
      } catch (error) {
        yield {
          type: 'action:storage:delete-channel-result',
          data: {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    });

    builder.on('action:storage:delete-agent', async function* (event) {
      try {
        await storage.deleteAgent({ agentId: event.data.agentId });
        yield { type: 'action:storage:delete-agent-result', data: { success: true } };
      } catch (error) {
        yield {
          type: 'action:storage:delete-agent-result',
          data: {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    });

    builder.on('action:storage:get-events', async function* (_, state) {
      const events = await storage.getEvents(state.state);
      yield { type: 'action:storage:get-events-result', data: { events } };
    });

    builder.on('action:storage:get-variables', async function* () {
      const variables = await storage.getVariables();
      const masked: Record<string, string> = {};
      for (const [key, val] of Object.entries(variables)) {
        if (typeof val === 'object' && val !== null && val.secret) {
          masked[key] = '********';
        } else {
          masked[key] = typeof val === 'string' ? val : val.value;
        }
      }
      yield {
        type: 'action:storage:get-variables-result',
        data: { variables: masked },
      } as OpenBotEvent;
    });

    builder.on('action:storage:create-variable', async function* (event) {
      try {
        const { key, value, secret } = event.data;
        await storage.createVariable({ key, value, secret });
        yield { type: 'action:storage:create-variable-result', data: { success: true } };
      } catch (error) {
        yield {
          type: 'action:storage:create-variable-result',
          data: {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    });

    builder.on('action:storage:delete-variable', async function* (event) {
      try {
        await storage.deleteVariable({ key: event.data.key });
        yield { type: 'action:storage:delete-variable-result', data: { success: true } };
      } catch (error) {
        yield {
          type: 'action:storage:delete-variable-result',
          data: {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    });

    builder.on('action:storage:patch-channel-state', async function* (event, state) {
      try {
        await storage.patchChannelState({
          channelId: state.state.channelId,
          state: event.data.state,
        });
        yield { type: 'action:storage:patch-channel-state-result', data: { success: true } };
      } catch {
        yield { type: 'action:storage:patch-channel-state-result', data: { success: false } };
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
        yield { type: 'action:storage:patch-thread-state-result', data: { success: true } };
      } catch {
        yield { type: 'action:storage:patch-thread-state-result', data: { success: false } };
      }
    });

    builder.on('action:storage:list-files', async function* (event, context) {
      const channelId = context.state.channelId;
      const subPath = (event.data as any)?.path || '';
      try {
        const files = await storage.listFiles({ channelId, path: subPath });
        yield {
          type: 'action:storage:list-files:result',
          data: { success: true, files },
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
          data: { success: false, path: '', error: 'Path is required' },
        };
        return;
      }
      try {
        const content = await storage.readFile({ channelId, path: filePath });
        yield {
          type: 'action:storage:read-file:result',
          data: { success: true, content, path: filePath },
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
  },
};

export default storagePlugin;
