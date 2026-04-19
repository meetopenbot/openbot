import { MelonyPlugin } from 'melony';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import z from 'zod';

/**
 * Threads Plugin for Melony.
 * Automatically handles thread events and routes them through the storage service.
 */
export const threadsPlugin = (): MelonyPlugin<OpenBotState, OpenBotEvent> => (builder) => {
  builder.on('action:create_thread', async function* (event, context) {
    // override the threadId in the state so the next agent:invoke event will reply in the same thread
    context.state.threadId = event.meta?.threadId;

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

    yield {
      type: 'agent:invoke',
      data: {
        content: `Thread created with ID ${event.meta?.threadId}. Please reply to the thread.`,
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
