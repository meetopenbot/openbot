import { openai } from '@ai-sdk/openai';
import { melony } from 'melony';
import { OpenBotEvent, OpenBotState } from './types.js';
import { aiSdkPlugin } from '../plugins/ai-sdk.js';
import { storagePlugin } from '../plugins/storage.js';
import { storageService } from '../services/storage.js';

export const createOpenBot = ({ agentId }: { agentId: string }) => {
  const runtime = melony<OpenBotState, OpenBotEvent>()
    .on('user:input', async function* (event) {
      yield {
        type: 'client:ui:message',
        data: {
          content: event.data.content,
          role: 'user',
        },
        meta: {
          agentId,
        },
      };

      yield {
        type: 'plugin:ai-sdk:input',
        data: {
          content: event.data.content,
        },
      };
    })
    .on('plugin:ai-sdk:output', async function* (event) {
      yield {
        type: 'client:ui:message',
        data: {
          content: event.data.content,
          role: 'assistant',
        },
        meta: {
          agentId,
        },
      };
    })
    .use(
      aiSdkPlugin({
        model: openai('gpt-4o-mini'),
        system: async (context) => {
          // Get the channel details
          const channelDetails = await storageService.getChannelDetails({
            threadId: context.state.threadId,
          });

          return `You are a helpful assistant for the channel ${channelDetails.name}. The channel spec is ${channelDetails.spec}. The channel state is ${JSON.stringify(channelDetails.state)}.`;
        },
      }),
    )
    .use(storagePlugin({ storage: storageService }))
    .build();

  return runtime;
};
