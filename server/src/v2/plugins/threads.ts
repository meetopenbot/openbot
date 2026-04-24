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
    const { threadTitle, spec, initialState } = (event as any).data;

    if (!threadId) {
      console.warn('[threads] Cannot create thread: meta.threadId is missing');
      return;
    }

    // override the threadId in the state so the next agent:invoke event will reply in the same thread
    context.state.threadId = threadId;

    // persist the thread title, spec and initial state
    if (channelId && threadId) {
      try {
        const patch: Record<string, unknown> = {
          ...((initialState as Record<string, unknown>) || {}),
        };

        if (threadTitle?.trim()) {
          patch.generatedName = threadTitle.trim();
        }

        await storageService.patchThreadState({
          channelId,
          threadId,
          state: patch,
        });

        if (typeof spec === 'string' && spec.trim()) {
          await storageService.patchThreadSpec({
            channelId,
            threadId,
            spec,
          });
        }

        context.state.threadDetails = await storageService.getThreadDetails({
          channelId,
          threadId,
        });
      } catch (error) {
        console.warn(
          `[threads] Failed to initialize thread for channel ${channelId} thread ${threadId}`,
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
        threadTitle,
      },
      meta: {
        threadId,
      },
    } as any;
  });

  builder.on('action:create_channel', async function* (event) {
    const { channelId, spec, initialState } = (event as any).data;
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
      await storageService.createChannel({
        channelId: rawChannelId,
        spec: channelSpec,
        initialState: initialState as Record<string, unknown>,
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
      threadTitle: z.string().describe('Short descriptive title for the thread.'),
      spec: z
        .string()
        .optional()
        .describe('Initial markdown content for the thread spec (SPEC.md).'),
      initialState: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'Initial state object for the thread. Use this to seed the thread with context or a `todos` list. ' +
            'Keep todos simple: { id: string, task: string, status: "pending" | "in_progress" | "done" }.',
        ),
    }),
  },
  create_channel: {
    description:
      'Create a new channel. Use this when you think the user intent is completelly different from the current channel and should be split into multiple channels. Before creating, always notify with details and ask for confirmation. If user asks basic questions, no need to create a channel.',
    inputSchema: z.object({
      channelId: z
        .string()
        .describe('Unique channel ID. Example: product-launch, backend-platform, or channel_roadmap.'),
      spec: z.string().optional().describe('Optional initial markdown content for the channel spec.'),
      initialState: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Optional initial state object for the channel.'),
    }),
  },
};

export const plugin = {
  name: 'threads',
  description: 'Threads plugin',
  version: '1.0.0',
  author: 'OpenBot',
  license: 'MIT',
  website: 'https://openbot.one',
  factory: threadsPlugin,
  toolDefinitions: threadToolDefinitions,
};
