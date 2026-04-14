import { MelonyPlugin, RuntimeContext } from 'melony';
import { generateText, type LanguageModel } from 'ai';
import { z } from 'zod';
import { OpenBotEvent, OpenBotState } from '../app/types.js';

export interface AISDKPluginOptions {
  /** Provider model (e.g. `openai('gpt-4o-mini')`). String IDs like `'openai/gpt-4o-mini'` use Vercel AI Gateway and need `AI_GATEWAY_API_KEY`, not `OPENAI_API_KEY`. */
  model: LanguageModel;
  system?: string | ((context: RuntimeContext) => string | Promise<string>);
  toolDefinitions?: Record<
    string,
    {
      description: string;
      inputSchema: z.ZodType<any>;
    }
  >;
}

/**
 * AI SDK Plugin for Melony.
 * Automatically handles text events and routes them through an AI SDK using Vercel AI SDK.
 * It can also automatically trigger events based on tool calls.
 */
export const aiSdkPlugin =
  (options: AISDKPluginOptions): MelonyPlugin<OpenBotState, OpenBotEvent> =>
  (builder) => {
    const { model, system, toolDefinitions = {} } = options;

    builder.on('plugin:ai-sdk:input', async function* (event, context) {
      const result = await generateText({
        model,
        system: typeof system === 'function' ? await system(context) : system,
        messages: [
          {
            role: 'user',
            content: event.data.content,
          },
        ],
        tools: toolDefinitions,
      });

      yield {
        type: 'plugin:ai-sdk:output',
        data: {
          content: result.text,
        },
      };
    });
  };
