import { MelonyPlugin } from 'melony';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import z from 'zod';
import { storageService } from '../services/storage.js';

/**
 * Threads Plugin for Melony.
 * Automatically handles thread events and routes them through the storage service.
 */
export const threadsPlugin = (): MelonyPlugin<OpenBotState, OpenBotEvent> => (builder) => {
  builder.on('action:create_thread', async function* (event, context) {
    // we take the threadId from the meta so the next agent:invoke event will reply in the same thread
    const threadId = event.meta?.threadId;
    const channelId = context.state.channelId;

    if (!threadId) {
      console.warn('[threads] Cannot create thread: meta.threadId is missing');
      return;
    }

    // override the threadId in the state so the next agent:invoke event will reply in the same thread
    context.state.threadId = threadId;

    // persist the thread title so we can use it later
    if (channelId && threadId && (event as any).data.threadTitle?.trim()) {
      try {
        await storageService.patchThreadState({
          channelId,
          threadId,
          state: {
            generatedName: (event as any).data.threadTitle.trim(),
          },
        });

        context.state.threadDetails = await storageService.getThreadDetails({
          channelId,
          threadId,
        });
      } catch (error) {
        console.warn(
          `[threads] Failed to persist generated thread title for channel ${channelId} thread ${threadId}`,
          error,
        );
      }
    }

    // return the result of the tool call
    yield {
      type: 'action:create_thread:result',
      data: {
        success: true,
        threadId,
        threadTitle: (event as any).data.threadTitle,
      },
      meta: {
        threadId,
      },
    } as any;
  });

  builder.on('action:create_channel', async function* (event) {
    const rawChannelId = ((event as any).data.channelId || '').trim();
    const channelSpec = typeof (event as any).data.spec === 'string' ? (event as any).data.spec : '';

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
      await storageService.createChannel({
        channelId: rawChannelId,
        spec: channelSpec,
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
          content: `Created channel \`${rawChannelId}\`.\n\n[Open channel](${channelUrl})`,
        },
        meta: event.meta,
      } as any;
    } catch (error) {
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
};

export const threadToolDefinitions = {
  create_thread: {
    description:
      'Create a new thread. Use this when you think the user intent is complex and should be split into multiple steps. If user asks basic questions, no need to create a thread.',
    inputSchema: z.object({
      threadTitle: z.string(),
    }),
  },
  create_channel: {
    description: 'Create a new channel. Use this when you think the user intent is completelly different from the current channel and should be split into multiple channels. Before creating, always notify with details and ask for confirmation. If user asks basic questions, no need to create a channel.',
    inputSchema: z.object({
      channelId: z
        .string()
        .describe('Unique channel ID. Example: product-launch, backend-platform, or channel_roadmap.'),
      spec: z.string().optional().describe('Optional initial markdown content for the channel spec.'),
    }),
  },
};

export const plugin = {
  name: 'storage',
  description: 'Storage plugin',
  version: '1.0.0',
  author: 'OpenBot',
  license: 'MIT',
  website: 'https://openbot.one',
  factory: threadsPlugin,
  toolDefinitions: threadToolDefinitions,
};
