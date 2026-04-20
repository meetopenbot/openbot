import { MelonyPlugin, RuntimeContext } from 'melony';
import { generateText, ModelMessage, type LanguageModel } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { OpenBotEvent, OpenBotState, ShortTermMessage } from '../app/types.js';
import { Storage } from './storage.js';

export interface AISDKPluginOptions {
  /**
   * Provider model as a standardized string (e.g. `openai/gpt-4o-mini`, `anthropic/claude-3-5-sonnet-20240620`).
   * Default: `openai/gpt-4o-mini`
   */
  model?: string;
  system?: string | ((context: RuntimeContext) => string | Promise<string>);
  storage?: Storage;
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

async function buildSystemPrompt(
  state: OpenBotState,
  system?: string | ((context: RuntimeContext) => string | Promise<string>),
  context?: RuntimeContext,
  storage?: Storage,
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

    if (storage) {
      try {
        const channelEvents = await storage.getEvents({ channelId: state.channelId });
        if (channelEvents.length > 0) {
          const formattedEvents = channelEvents
            .slice(-20)
            .map((e) => `- ${e.type}: ${JSON.stringify((e as any).data || {})}`)
            .join('\n');
          sections.push(`## CHANNEL RECENT ACTIVITIES (events)\n${formattedEvents}`);
        }
      } catch (error) {
        console.warn(`[ai-sdk] Failed to fetch channel events for ${state.channelId}`, error);
      }
    }
  }

  if (state.threadDetails) {
    sections.push(`## THREAD NAME\n${state.threadDetails.name}`);
    sections.push(`## THREAD SPECIFICATION\n${state.threadDetails.spec}`);
    sections.push(`## THREAD STATE\n${JSON.stringify(state.threadDetails.state, null, 2)}`);

    if (storage && state.threadId) {
      try {
        const threadEvents = await storage.getEvents({
          channelId: state.channelId,
          threadId: state.threadId,
        });
        if (threadEvents.length > 0) {
          const formattedEvents = threadEvents
            .slice(-20)
            .map((e) => `- ${e.type}: ${JSON.stringify((e as any).data || {})}`)
            .join('\n');
          sections.push(`## THREAD RECENT ACTIVITIES (events)\n${formattedEvents}`);
        }
      } catch (error) {
        console.warn(
          `[ai-sdk] Failed to fetch thread events for channel ${state.channelId} thread ${state.threadId}`,
          error,
        );
      }
    }
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
    const {
      model: modelString = 'openai/gpt-4o-mini',
      system,
      storage,
      toolDefinitions = {},
    } = options;

    const model = resolveModel(modelString);

    builder.on('agent:invoke', async function* (event, context) {
      // extract threadId if model decides to reply in a thread
      const threadId = event.meta?.threadId || context.state.threadId;
      const systemPrompt = await buildSystemPrompt(context.state, system, context, storage);

      context.state.shortTermMessages = [
        ...(context.state.shortTermMessages ?? []),
        {
          role: event.data?.role || 'user',
          content: (event as any)?.data?.content || '',
        },
      ];

      const result = await generateText({
        model,
        system: systemPrompt,
        messages: context.state.shortTermMessages,
        tools: toolDefinitions,
      });

      const toolCalls = result.toolCalls ?? [];

      if (toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          const toolEvent = {
            type: `action:${toolCall.toolName}` as OpenBotEvent['type'],
            data: toolCall.input,
            meta: {
              toolCallId: toolCall.toolCallId,
              agentId: context.state.agentId,
              threadId,
            },
          } as unknown as OpenBotEvent;
          yield toolEvent;
        }
      }

      if (result.text) {
        context.state.shortTermMessages = [
          ...(context.state.shortTermMessages ?? []),
          { role: 'assistant', content: result.text },
        ];

        yield {
          type: 'agent:output',
          data: {
            content: result.text,
          },
        };
      }
    });
  };
