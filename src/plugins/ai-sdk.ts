import { MelonyPlugin, RuntimeContext } from 'melony';
import { generateText, type LanguageModel, type ModelMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { OpenBotEvent, OpenBotState, ShortTermMessage } from '../app/types.js';
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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const readPersistedShortTermMessages = (state: OpenBotState): ShortTermMessage[] => {
  const source = state.threadDetails?.state ?? state.channelDetails?.state;
  const record = asRecord(source);
  const raw = record.shortTermMessages;
  return Array.isArray(raw) ? (raw as ShortTermMessage[]) : [];
};

const persistShortTermMessages = async (
  state: OpenBotState,
  storage: Storage | undefined,
): Promise<void> => {
  if (!storage) return;

  const shortTermMessages = state.shortTermMessages ?? [];
  if (state.threadId) {
    await storage.patchThreadState({
      channelId: state.channelId,
      threadId: state.threadId,
      state: { shortTermMessages },
    });
    return;
  }

  await storage.patchChannelState({
    channelId: state.channelId,
    state: { shortTermMessages },
  });
};

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

      const ensureShortTermMessages = (state: OpenBotState) => {
        if (!state.shortTermMessages || state.shortTermMessages.length === 0) {
          state.shortTermMessages = readPersistedShortTermMessages(state);
        }
      };

      const mapToCoreMessages = (messages: ShortTermMessage[]): ModelMessage[] => {
        return messages.map((m): ModelMessage => {
          if (m.role === 'assistant' && m.toolCalls) {
            const assistantContent: ModelMessage[] = [
              {
                role: 'assistant',
                content: [
                  { type: 'text', text: m.content || '' },
                  ...m.toolCalls.map((tc) => ({
                    type: 'tool-call' as const,
                    toolCallId: tc.id,
                    toolName: tc.function.name,
                    input: JSON.parse(tc.function.arguments),
                  })),
                ],
              },
            ];

            return assistantContent[0];
          }
          if (m.role === 'assistant') {
            return {
              role: 'assistant',
              content: m.content || '',
            };
          }
          if (m.role === 'tool') {
            return {
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolCallId: m.toolCallId,
                  toolName: m.toolName,
                  output: {
                    type: 'text',
                    value: JSON.stringify(m.content),
                  },
                },
              ],
            };
          }
          return m;
        });
      };

      const runLLM = async function* (
        context: RuntimeContext<OpenBotState, OpenBotEvent>,
        threadId?: string,
      ): AsyncGenerator<OpenBotEvent> {
        ensureShortTermMessages(context.state);
        const systemPrompt = await buildSystemPrompt(
          context.state,
          system,
          context,
          storage,
          contextEngine,
        );

        const coreMessages = mapToCoreMessages(context.state.shortTermMessages || []);

        try {
          const result = await generateText({
            model,
            system: systemPrompt,
            messages: coreMessages,
            tools: toolDefinitions,
          });

          const toolCalls = result.toolCalls ?? [];

          if (toolCalls.length > 0) {
            // Add assistant message with tool calls to state
            context.state.shortTermMessages = [
              ...(context.state.shortTermMessages ?? []),
              {
                role: 'assistant',
                content: result.text || '',
                toolCalls: toolCalls.map((tc) => ({
                  id: tc.toolCallId,
                  type: 'function',
                  function: {
                    name: tc.toolName,
                    arguments: JSON.stringify(tc.input),
                  },
                })),
              },
            ];
            await persistShortTermMessages(context.state, storage);

            for (const toolCall of toolCalls) {
              yield {
                type: `action:${toolCall.toolName}` as OpenBotEvent['type'],
                data: toolCall.input,
                meta: {
                  toolCallId: toolCall.toolCallId,
                  agentId: context.state.agentId,
                  threadId,
                },
              } as unknown as OpenBotEvent;
            }
          }

          if (result.text) {
            if (toolCalls.length === 0) {
              context.state.shortTermMessages = [
                ...(context.state.shortTermMessages ?? []),
                { role: 'assistant', content: result.text },
              ];
              await persistShortTermMessages(context.state, storage);
            }

            yield {
              type: 'agent:output',
              data: {
                content: result.text,
              },
              meta: {
                agentId: context.state.agentId,
                threadId,
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
            } as OpenBotEvent;
            return;
          }

          // Re-throw other errors
          throw error;
        }
      };

      builder.on('agent:invoke', async function* (event, context) {
        // if the agent:invoke is routed to a different agent, don't process it, it prevents infinite loops
        const routedTo = (event as { data?: { agentId?: string } }).data?.agentId;
        if (typeof routedTo === 'string' && routedTo && routedTo !== context.state.agentId) {
          return;
        }

        // extract threadId if model decides to reply in a thread
        const threadId = event.meta?.threadId || context.state.threadId;

        ensureShortTermMessages(context.state);
        context.state.shortTermMessages = [
          ...(context.state.shortTermMessages ?? []),
          {
            role: event.data?.role || 'user',
            content: (event)?.data?.content || '',
          },
        ];
        await persistShortTermMessages(context.state, storage);

        yield* runLLM(context, threadId);
      });

      builder.on('*', async function* (event, context) {
        if (!event.type.endsWith(':result')) return;
        if (event.meta?.agentId !== context.state.agentId) return;
        const toolCallId = event.meta?.toolCallId;
        if (!toolCallId) return;
        ensureShortTermMessages(context.state);

        // Extract tool name from event type (e.g., action:shell_exec:result -> shell_exec)
        const toolName = event.type.replace(/^action:/, '').replace(/:result$/, '');

        // Add tool result to state
        const resultData = (event as any).data;
        const content = typeof resultData === 'string' ? resultData : JSON.stringify(resultData);

        context.state.shortTermMessages = [
          ...(context.state.shortTermMessages ?? []),
          { role: 'tool', content, toolCallId, toolName },
        ];
        await persistShortTermMessages(context.state, storage);

        // Check if we should re-trigger LLM
        // We re-trigger if the last assistant message's tool calls are all fulfilled
        const lastAssistant = [...(context.state.shortTermMessages ?? [])]
          .reverse()
          .find((m: any) => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0);

        if (lastAssistant && (lastAssistant as any).toolCalls) {
          const allFulfilled = (lastAssistant as any).toolCalls.every((tc: any) =>
            context.state.shortTermMessages?.some(
              (m: any) => m.role === 'tool' && m.toolCallId === tc.id,
            ),
          );

          if (allFulfilled) {
            // Some tools intentionally terminate the current agent path (e.g., handoff).
            // We still persist their tool result for provider consistency, but do not continue this agent.
            if (toolName === 'handoff') return;
            const threadId = event.meta?.threadId || context.state.threadId;
            yield* runLLM(context, threadId);
          }
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
  id: 'ai-sdk',
  name: 'AI SDK',
  description: 'Built-in AI SDK plugin',
  kind: 'runtime' as const,
  factory: () => aiSdkPlugin({}),
};
