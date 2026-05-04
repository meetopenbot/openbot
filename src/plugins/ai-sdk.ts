import { MelonyPlugin, RuntimeContext } from 'melony';
import { generateText, type LanguageModel } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import { Storage } from './storage.js';
import { createDefaultContextEngine } from '../harness/context.js';

export interface AISDKPluginOptions {
  /**
   * Provider model as a standardized string (e.g. `openai/gpt-4o-mini`, `anthropic/claude-3-5-sonnet-20240620`).
   * Default: `openai/gpt-4o-mini`
   */
  model?: string;
  system?: string | ((context: RuntimeContext) => string | Promise<string>);
  storage?: Storage;
  contextEngine?: {
    buildContext: (state: OpenBotState, storage?: Storage) => Promise<string>;
  };
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
  contextEngine?: {
    buildContext: (state: OpenBotState, storage?: Storage) => Promise<string>;
  },
): Promise<string> {
  const sections: string[] = [];

  if (system && typeof system === 'string') {
    sections.push(system);
  }

  if (system && typeof system === 'function' && context) {
    sections.push(await system(context));
  }

  if (contextEngine) {
    sections.push(await contextEngine.buildContext(state, storage));
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
      contextEngine = createDefaultContextEngine(),
      toolDefinitions = {},
    } = options;

    const model = resolveModel(modelString);

    builder.on('agent:invoke', async function* (event, context) {
      // if the agent:invoke is routed to a different agent, don't process it, it prevents infinite loops
      const routedTo = (event as { data?: { agentId?: string } }).data?.agentId;
      if (typeof routedTo === 'string' && routedTo && routedTo !== context.state.agentId) {
        return;
      }

      // extract threadId if model decides to reply in a thread
      const threadId = event.meta?.threadId || context.state.threadId;
      const systemPrompt = await buildSystemPrompt(
        context.state,
        system,
        context,
        storage,
        contextEngine,
      );

      context.state.shortTermMessages = [
        ...(context.state.shortTermMessages ?? []),
        {
          role: event.data?.role || 'user',
          content: (event as any)?.data?.content || '',
        },
      ];

      try {
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
            meta: {
              agentId: context.state.agentId,
            },
          };
        }
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        const isApiKeyError =
          errorMessage.includes('API key') ||
          errorMessage.includes('401') ||
          errorMessage.includes('Unauthorized') ||
          errorMessage.includes('authentication');

        if (isApiKeyError) {
          const provider = modelString.split('/')[0];
          const envVar = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';

          yield {
            type: 'client:ui:widget',
            data: {
              kind: 'form',
              widgetId: `api_key_request_${Date.now()}`,
              title: `${provider.toUpperCase()} API Key Required`,
              description: `The ${provider} API returned an authentication error. Please provide a valid API key to continue. The key provided here never leaves your runtime Computer.`,
              fields: [
                {
                  id: 'apiKey',
                  label: 'API Key',
                  type: 'text',
                  placeholder: `sk-...`,
                  required: true,
                },
              ],
              submitLabel: 'Save API Key',
              metadata: {
                type: 'api_key_request',
                provider,
                envVar,
              },
            },
            meta: {
              agentId: context.state.agentId,
              threadId,
            },
          };
          return;
        }

        // Re-throw other errors
        throw error;
      }
    });

    builder.on('client:ui:widget:response', async function* (event, context) {
      const { metadata, values } = event.data;

      if (metadata?.type === 'api_key_request' && values?.apiKey) {
        const key = metadata.envVar as string;
        const value = values.apiKey as string;

        if (storage) {
          try {
            await storage.createVariable({ key, value, secret: true });

            yield {
              type: 'agent:output',
              data: {
                content: `Successfully saved ${metadata.provider} API key to workspace variables.`,
              },
              meta: {
                agentId: context.state.agentId,
              },
            };

            // Update the widget to show success
            yield {
              type: 'client:ui:widget',
              data: {
                widgetId: event.data.widgetId,
                kind: 'message',
                title: 'API Key Saved',
                body: `Successfully saved ${metadata.provider} API key. You can now continue your conversation.`,
                state: 'submitted',
                actions: [{ id: 'ok', label: 'Got it', variant: 'primary' }],
              },
              meta: {
                agentId: context.state.agentId,
              },
            };
          } catch (error) {
            yield {
              type: 'agent:output',
              data: {
                content: `Failed to save API key: ${error instanceof Error ? error.message : 'Unknown error'}`,
              },
              meta: {
                agentId: context.state.agentId,
              },
            };
          }
        }
      }
    });
  };

export const plugin = {
  name: 'ai-sdk',
  description: 'Built-in AI SDK plugin',
  kind: 'runtime' as const,
  factory: aiSdkPlugin,
};
