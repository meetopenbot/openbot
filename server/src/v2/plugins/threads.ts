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
    const threadId = event.meta?.threadId;
    const channelId = context.state.channelId;

    // override the threadId in the state so the next agent:invoke event will reply in the same thread
    context.state.threadId = threadId;

    // persist the thread title so we can use it later
    if (channelId && threadId && event.data.threadTitle?.trim()) {
      try {
        await storageService.patchThreadState({
          channelId,
          threadId,
          state: {
            generatedName: event.data.threadTitle.trim(),
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
        threadId: event.meta?.threadId,
        threadTitle: event.data.threadTitle,
      },
      meta: {
        threadId: event.meta?.threadId,
      },
    };

    // invoke the next agent in the thread
    yield {
      type: 'agent:invoke',
      data: {
        content:
          `Tool call \`create_thread\` completed successfully.\n` +
          `- toolCallId: ${event.meta?.toolCallId}\n` +
          `- threadId: ${event.meta?.threadId}\n` +
          `- threadTitle: ${event.data.threadTitle}\n\n` +
          'Continue the conversation in this thread.',
      },
      meta: {
        threadId: event.meta?.threadId,
      },
    };
  });
};

export const threadToolDefinitions = {
  create_thread: {
    description: 'Create a new thread',
    inputSchema: z.object({
      threadTitle: z.string(),
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
