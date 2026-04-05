import { z } from 'zod';
import { MelonyPlugin } from 'melony';
import { ConversationEvent, ConversationState } from '../app/types.js';
import { createChannelConversation, saveChannelSpec } from '../services/conversation.js';

export const channelToolDefinitions = {
  createChannel: {
    description: 'Create a new channel with a title and an initial specification (SPEC.md).',
    inputSchema: z.object({
      title: z.string().describe('The display title of the channel (e.g., "Product Launch").'),
      spec: z.string().describe('The initial content for SPEC.md. Should define goals, rules, and context.'),
    }),
  },
};

export const channelPlugin = (): MelonyPlugin<ConversationState, ConversationEvent> => (builder) => {
  builder.on('action:createChannel', async function* (event, { state }) {
    const { title, spec, toolCallId } = event.data;

    try {
      const channel = await createChannelConversation(title);
      if (spec) {
        await saveChannelSpec(channel.id, spec);
      }

      yield {
        type: 'action:result',
        data: {
          action: 'createChannel',
          result: `Successfully created channel "${title}" with ID ${channel.id}.`,
          toolCallId,
        },
      } as ConversationEvent;

      // Notify client to refresh conversation list
      yield {
        type: 'client:invalidate',
        data: { tags: ['conversations'] },
      } as any;

    } catch (error: any) {
      yield {
        type: 'action:result',
        data: {
          action: 'createChannel',
          result: `Error creating channel: ${error.message}`,
          toolCallId,
        },
      } as ConversationEvent;
    }
  });
};
