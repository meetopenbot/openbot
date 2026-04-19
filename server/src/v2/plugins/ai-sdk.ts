import { MelonyPlugin, RuntimeContext } from 'melony';
import { generateText, type LanguageModel } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { OpenBotEvent, OpenBotState, ShortTermMessage } from '../app/types.js';

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

function trimShortTermMessages(messages: ShortTermMessage[], maxMessages = 20): ShortTermMessage[] {
  if (messages.length <= maxMessages) {
    return messages;
  }
  return messages.slice(-maxMessages);
}

function appendUniqueUserMessage(
  history: ShortTermMessage[],
  content: string,
): ShortTermMessage[] {
  const last = history[history.length - 1];
  const isDuplicateUserMessage = last?.role === 'user' && last.content === content;

  return isDuplicateUserMessage ? history : [...history, { role: 'user', content }];
}

function appendAssistantMessage(history: ShortTermMessage[], content: string): ShortTermMessage[] {
  return [...history, { role: 'assistant', content }];
}

async function buildSystemPrompt(
  state: OpenBotState,
  system?: string | ((context: RuntimeContext) => string | Promise<string>),
  context?: RuntimeContext,
): Promise<string> {
  const sections: string[] = [];

  if (state.agentDetails) {
    sections.push(`## AGENT NAME\n${state.agentDetails.name}`);
    sections.push(`## AGENT SPECIFICATION\n${state.agentDetails.instructions}`);
  }

  if (state.channelDetails) {
    sections.push(`## CHANNEL NAME\n${state.channelDetails.name}`);
    sections.push(`## CHANNEL SPECIFICATION\n${state.channelDetails.spec}`);
    sections.push(`## CHANNEL STATE\n${JSON.stringify(state.channelDetails.state, null, 2)}`);
  }

  if (system && typeof system === 'string') {
    sections.push(`## SYSTEM INSTRUCTIONS\n${system}`);
  }

  if (system && typeof system === 'function' && context) {
    sections.push(await system(context));
  }

  return sections.join('\n\n');
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
      // extract threadId if model decides to reply in a thread
      const threadId = event.meta?.threadId || context.state.threadId;
      const systemPrompt = await buildSystemPrompt(context.state, system, context);
      const history = context.state.shortTermMessages ?? [];
      const messagesForModel = appendUniqueUserMessage(history, event.data.content);

      const result = await generateText({
        model,
        system: systemPrompt,
        messages: messagesForModel,
        tools: toolDefinitions,
      });

      context.state.shortTermMessages = trimShortTermMessages(messagesForModel);

      const toolCalls = result.toolCalls ?? [];

      if (toolCalls.length > 0) {
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
        context.state.shortTermMessages = trimShortTermMessages(
          appendAssistantMessage(context.state.shortTermMessages ?? [], result.text),
        );

        yield {
          type: 'agent:output',
          data: {
            content: result.text,
          },
        };
      }
    });
  };
