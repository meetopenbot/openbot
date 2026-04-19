import { MelonyPlugin, RuntimeContext } from 'melony';
import { generateText, type LanguageModel } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { OpenBotEvent, OpenBotState } from '../app/types.js';

export interface AISDKPluginOptions {
  /**
   * Provider model as a standardized string (e.g. `openai/gpt-4o-mini`, `anthropic/claude-3-5-sonnet-20240620`).
   * Default: `openai/gpt-4o-mini`
   */
  model?: string;
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
 * Resolves a standardized model string to an AI SDK LanguageModel.
 */
function resolveModel(modelString: string): LanguageModel {
  const [provider, ...rest] = modelString.split('/');
  const modelId = rest.join('/');

  if (!modelId) {
    throw new Error(`Invalid model string: "${modelString}". Expected format: "provider/model-id"`);
  }

  switch (provider) {
    case 'openai':
      return openai(modelId);
    case 'anthropic':
      return anthropic(modelId);
    default:
      throw new Error(`Unsupported AI provider: "${provider}"`);
  }
}

/**
 * AI SDK Plugin for Melony.
 * Automatically handles text events and routes them through an AI SDK using Vercel AI SDK.
 * It can also automatically trigger events based on tool calls.
 */
export const aiSdkPlugin =
  (options: AISDKPluginOptions): MelonyPlugin<OpenBotState, OpenBotEvent> =>
  (builder) => {
    const { model: modelString = 'openai/gpt-4o-mini', system, toolDefinitions = {} } = options;

    const model = resolveModel(modelString);

    builder.on('agent:invoke', async function* (event, context) {
      const { agentDetails, channelDetails } = context.state;

      // extract threadId if model decides to reply in a thread
      const threadId = event.meta?.threadId || context.state.threadId;

      let systemPrompt = '';

      if (agentDetails) {
        systemPrompt += `## AGENT NAME\n${agentDetails.name}\n\n`;
        systemPrompt += `## AGENT SPECIFICATION\n${agentDetails.instructions}\n\n`;
      }

      if (channelDetails) {
        systemPrompt += `## CHANNEL NAME\n${channelDetails.name}\n\n`;
        systemPrompt += `## CHANNEL SPECIFICATION\n${channelDetails.spec}\n\n`;
        systemPrompt += `## CHANNEL STATE\n${JSON.stringify(channelDetails.state, null, 2)}\n\n`;
      }

      if (system && typeof system === 'string') {
        systemPrompt += `## SYSTEM INSTRUCTIONS\n${system}`;
      }

      if (system && typeof system === 'function') {
        systemPrompt += await system(context);
      }

      const result = await generateText({
        model,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: event.data.content,
          },
        ],
        tools: toolDefinitions,
      });

      const toolCalls = result.toolCalls ?? [];

      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          yield {
            type: `action:${toolCall.toolName}` as OpenBotEvent['type'],
            data: toolCall.input,
            meta: {
              toolCallId: toolCall.toolCallId,
              agentId: context.state.agentId,
              threadId,
            },
          };
        }
      }

      if (result.text) {
        yield {
          type: 'agent:output',
          data: {
            content: result.text,
          },
        };
      }
    });
  };
