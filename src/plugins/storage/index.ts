import z from 'zod';
import type { Plugin } from '../../services/plugins/types.js';
import { OpenBotEvent } from '../../app/types.js';

const storageToolDefinitions = {
  patch_channel_details: {
    description: 'Patch current channel details (state, spec, cwd).',
    inputSchema: z
      .object({
        state: z.record(z.string(), z.unknown()).optional(),
        spec: z.string().optional(),
        cwd: z.string().optional(),
      })
      .refine(
        (value) =>
          value.state !== undefined || value.spec !== undefined || value.cwd !== undefined,
        { message: 'Provide at least one of state, spec, or cwd.' },
      ),
  },
  patch_thread_details: {
    description: 'Patch current thread state (metadata, plans, names).',
    inputSchema: z.object({
      state: z
        .record(z.string(), z.unknown())
        .describe('JSON state object merged into the thread.'),
    }),
  },
};

export const storagePlugin: Plugin = {
  id: 'storage',
  name: 'Storage',
  description: 'Patch channel and thread state.',
  toolDefinitions: storageToolDefinitions,
  factory: ({ storage }) => (builder) => {
    builder.on('action:create_thread', async function* (event, context) {
      const threadId = event.meta?.threadId;
      const channelId = context.state.channelId;
      const { threadTitle, initialState } = (event.data || {}) as {
        threadTitle?: string;
        initialState?: Record<string, unknown>;
      };

      if (!threadId || !channelId) return;

      context.state.threadId = threadId;
      await storage.createThread({
        channelId,
        threadId,
        threadTitle,
        initialState: initialState || {},
      });
      context.state.threadDetails = await storage.getThreadDetails({ channelId, threadId });

      yield {
        type: 'action:create_thread:result',
        data: { success: true, threadId, threadTitle },
        meta: { ...(event.meta || {}), threadId, agentId: context.state.agentId },
      } as OpenBotEvent;
    });

    builder.on('action:patch_channel_details', async function* (event, context) {
      const data = (event.data || {}) as {
        state?: Record<string, unknown>;
        spec?: string;
        cwd?: string;
      };
      const channelId = context.state.channelId;
      const meta = { ...(event.meta || {}), agentId: context.state.agentId };

      try {
        if (data.state !== undefined) {
          await storage.patchChannelState({ channelId, state: data.state });
        }
        if (data.spec !== undefined) {
          await storage.patchChannelSpec({ channelId, spec: data.spec });
        }
        if (data.cwd !== undefined) {
          await storage.patchChannelState({ channelId, state: { cwd: data.cwd } });
        }
        context.state.channelDetails = await storage.getChannelDetails({ channelId });
        yield {
          type: 'action:patch_channel_details:result',
          data: { success: true },
          meta,
        } as OpenBotEvent;
      } catch (error) {
        yield {
          type: 'action:patch_channel_details:result',
          data: { success: false, updatedFields: [] },
          meta,
        } as OpenBotEvent;
      }
    });

    builder.on('action:patch_thread_details', async function* (event, context) {
      const threadId = event.meta?.threadId || context.state.threadId;
      const channelId = context.state.channelId;
      const meta = { ...(event.meta || {}), threadId, agentId: context.state.agentId };
      const state = (event.data as { state?: Record<string, unknown> })?.state;

      if (!threadId || state === undefined) {
        yield {
          type: 'action:patch_thread_details:result',
          data: { success: false },
          meta,
        } as OpenBotEvent;
        return;
      }

      await storage.patchThreadState({ channelId, threadId, state });
      context.state.threadDetails = await storage.getThreadDetails({ channelId, threadId });
      yield {
        type: 'action:patch_thread_details:result',
        data: { success: true },
        meta,
      } as OpenBotEvent;
    });

    builder.on('action:storage:get-channels', async function* () {
      const channels = await storage.getChannels();
      yield { type: 'action:storage:get-channels-result', data: { channels } };
    });

    builder.on('action:storage:get-threads', async function* (event) {
      const channelId = (event.data as { channelId?: string })?.channelId || '';
      const threads = await storage.getThreads({ channelId });
      yield { type: 'action:storage:get-threads-result', data: { threads } };
    });

    builder.on('action:storage:set-last-read', async function* (event, context) {
      const channelId = context.state.channelId;
      const threadId = event.meta?.threadId || context.state.threadId;
      const lastReadEventId = (event.data as { lastReadEventId?: string })?.lastReadEventId;
      if (!lastReadEventId) return;
      await storage.setLastRead({ channelId, threadId, lastReadEventId });
      yield { type: 'action:storage:set-last-read-result', data: { success: true } };
    });

    builder.on('action:storage:get-channel-details', async function* (_, context) {
      const channelDetails = await storage.getChannelDetails({ channelId: context.state.channelId });
      yield { type: 'action:storage:get-channel-details-result', data: { channelDetails } };
    });

    builder.on('action:storage:get-thread-details', async function* (_, context) {
      if (!context.state.threadId) return;
      const threadDetails = await storage.getThreadDetails({
        channelId: context.state.channelId,
        threadId: context.state.threadId,
      });
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
      const agentId = (event.data as { agentId?: string })?.agentId;
      if (!agentId) return;
      const agentDetails = await storage.getAgentDetails({ agentId });
      yield { type: 'action:storage:get-agent-details-result', data: { agentDetails } };
    });

    builder.on('action:storage:get-events', async function* (_, context) {
      const events = await storage.getEvents({
        channelId: context.state.channelId,
        threadId: context.state.threadId,
      });
      yield { type: 'action:storage:get-events-result', data: { events } };
    });

    builder.on('action:storage:patch-channel-state', async function* (event, context) {
      const patch = (event.data as { state?: unknown })?.state;
      if (patch === undefined) return;
      await storage.patchChannelState({ channelId: context.state.channelId, state: patch });
      yield { type: 'action:storage:patch-channel-state-result', data: { success: true } };
    });

    builder.on('action:storage:patch-thread-state', async function* (event, context) {
      const threadId = event.meta?.threadId || context.state.threadId;
      const patch = (event.data as { state?: unknown })?.state;
      if (!threadId || patch === undefined) return;
      await storage.patchThreadState({ channelId: context.state.channelId, threadId, state: patch });
      yield { type: 'action:storage:patch-thread-state-result', data: { success: true } };
    });
  },
};

export default storagePlugin;
