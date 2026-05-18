import { MelonyPlugin, RuntimeContext } from 'melony';
import { generateText, type LanguageModel, type ModelMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { OpenBotEvent, OpenBotMessage, OpenBotState } from '../../app/types.js';
import { reconstructHistory } from '../../harness/history.js';
import { Storage } from '../../bus/types.js';
import type { ToolDefinition } from '../../bus/plugin.js';
import { createDefaultContextEngine } from '../../harness/context.js';
import { saveConfig } from '../../app/config.js';

/**
 * Maps OpenBot internal messages to Vercel AI SDK ModelMessages.
 */
function toModelMessages(messages: OpenBotMessage[]): ModelMessage[] {
  return messages.map((m): ModelMessage => {
    if (typeof m.content === 'string') {
      return m as ModelMessage;
    }

    return {
      role: m.role,
      content: m.content.map((part) => {
        if (part.type === 'text') {
          return { type: 'text', text: part.text };
        }
        if (part.type === 'tool-call') {
          return {
            type: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
          };
        }
        if (part.type === 'tool-result') {
          return {
            type: 'tool-result',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: {
              type: 'json',
              value: part.output,
            },
          };
        }
        throw new Error(`Unsupported message part type: ${(part as any).type}`);
      }),
    } as ModelMessage;
  });
}

export interface OpenBotRuntimeOptions {
  /** Provider model string (e.g. `openai/gpt-4o-mini`, `anthropic/claude-3-5-sonnet-20240620`). */
  model?: string;
  storage?: Storage;
  contextEngine?: {
    buildContext: (state: OpenBotState, storage?: Storage) => Promise<string>;
  };
  /** Tool definitions merged from all tool plugins attached to this agent. */
  toolDefinitions?: Record<string, ToolDefinition>;
}

function resolveModel(modelString: string): LanguageModel {
  const [provider, ...rest] = modelString.split('/');
  const modelId = rest.join('/');
  if (!modelId) {
    throw new Error(`Invalid model string: "${modelString}". Expected "provider/model-id".`);
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
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Per-message hard cap (in characters) on tool-result payloads we feed back
 *  to the model. Prevents one huge tool output from eating the context window;
 *  the original event remains intact in storage. */
const TOOL_RESULT_MAX_CHARS = 8000;

/** Sliding window: max number of messages we replay to the model on each
 *  invocation. Older turns stay on disk but are not sent. Keeps both the
 *  recent prompts and the prompt token budget bounded. */
const MAX_WINDOW_MESSAGES = 80;

const truncateToolPayload = (raw: unknown): string => {
  const serialized = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (serialized.length <= TOOL_RESULT_MAX_CHARS) return serialized;
  const dropped = serialized.length - TOOL_RESULT_MAX_CHARS;
  return `${serialized.slice(0, TOOL_RESULT_MAX_CHARS)}\n…[truncated ${dropped} chars]`;
};

async function buildSystemPrompt(
  state: OpenBotState,
  storage: Storage | undefined,
  contextEngine: {
    buildContext: (state: OpenBotState, storage?: Storage) => Promise<string>;
  },
): Promise<string> {
  return contextEngine.buildContext(state, storage);
}

/**
 * The standard OpenBot agent runtime.
 *
 * This is the opinionated execution loop for OpenBot. It owns `agent:invoke`,
 * runs the LLM, emits tool-call events, and stitches tool results back into
 * the conversation. Tools are supplied externally by the loader (merged from
 * every tool plugin attached to the same agent).
 */
export const openbotRuntime =
  (options: OpenBotRuntimeOptions): MelonyPlugin<OpenBotState, OpenBotEvent> =>
    (builder) => {
      const {
        model: modelString = 'openai/gpt-4o-mini',
        storage,
        contextEngine = createDefaultContextEngine(),
        toolDefinitions = {},
      } = options;

      let currentModelString = modelString;
      let model = resolveModel(currentModelString);

      const runLLM = async function* (
        context: RuntimeContext<OpenBotState, OpenBotEvent>,
        threadId?: string,
      ): AsyncGenerator<OpenBotEvent> {
        if (!storage) return;

        const systemPrompt = await buildSystemPrompt(context.state, storage, contextEngine);
        const events = await storage.getEvents({
          channelId: context.state.channelId,
          threadId: context.state.threadId,
        });

        console.log('system prompt', systemPrompt);

        const messages = reconstructHistory(events);

        try {
          const result = await generateText({
            model,
            system: systemPrompt,
            messages: toModelMessages(messages),
            tools: toolDefinitions as Record<string, { description: string; inputSchema: any }>,
          });

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
              } as unknown as OpenBotEvent;
            }
          }

          if (result.text) {
            yield {
              type: 'agent:output',
              data: { content: result.text },
              meta: { agentId: context.state.agentId, threadId },
            };
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const isApiKeyError =
            errorMessage.includes('API key') ||
            errorMessage.includes('401') ||
            errorMessage.includes('Unauthorized') ||
            errorMessage.includes('authentication');

          if (isApiKeyError) {
            const [currentProvider, ...rest] = currentModelString.split('/');
            const currentModelId = rest.join('/');
            yield {
              type: 'client:ui:widget',
              data: {
                kind: 'form',
                widgetId: `api_key_request_${Date.now()}`,
                title: `AI Provider API Key Required`,
                description: `The AI provider returned an authentication error. Select your provider, model, and provide a valid API key to continue. The key never leaves your local runtime.`,
                fields: [
                  {
                    id: 'provider',
                    label: 'Provider',
                    type: 'select',
                    required: true,
                    options: [
                      { label: 'OpenAI', value: 'openai' },
                      { label: 'Anthropic', value: 'anthropic' },
                    ],
                    defaultValue: currentProvider === 'anthropic' ? 'anthropic' : 'openai',
                  },
                  {
                    id: 'model',
                    label: 'Model',
                    type: 'text',
                    description:
                      'Model name without the provider prefix (e.g. `gpt-4o-mini` or `claude-3-5-sonnet-20240620`).',
                    placeholder: 'gpt-4o-mini',
                    required: true,
                    defaultValue: currentModelId,
                  },
                  {
                    id: 'apiKey',
                    label: 'API Key',
                    type: 'text',
                    placeholder: `sk-...`,
                    required: true,
                  },
                ],
                submitLabel: 'Save & Continue',
                metadata: {
                  type: 'api_key_request',
                },
              },
              meta: { agentId: context.state.agentId, threadId },
            } as OpenBotEvent;
            return;
          }

          throw error;
        }
      };

      builder.on('agent:invoke', async function* (event, context) {
        const routedTo = (event as { data?: { agentId?: string } }).data?.agentId;
        if (typeof routedTo === 'string' && routedTo && routedTo !== context.state.agentId) {
          return;
        }

        const threadId = event.meta?.threadId || context.state.threadId;
        yield* runLLM(context, threadId);
      });

      builder.on('*', async function* (event, context) {
        if (!event.type.endsWith(':result')) return;
        if (event.meta?.agentId !== context.state.agentId) return;
        const toolCallId = event.meta?.toolCallId;
        if (!toolCallId) return;

        if (!storage) return;

        const toolName = event.type.replace(/^action:/, '').replace(/:result$/, '');

        const events = await storage.getEvents({
          channelId: context.state.channelId,
          threadId: context.state.threadId,
        });

        // Find the assistant message that made this tool call
        const messages = reconstructHistory(events);
        const lastAssistant = [...messages]
          .reverse()
          .find(
            (m): m is Extract<OpenBotMessage, { role: 'assistant' }> =>
              m.role === 'assistant' && Array.isArray(m.content) && m.content.some((p: any) => p.type === 'tool-call'),
          );

        if (lastAssistant && Array.isArray(lastAssistant.content)) {
          const toolCalls = lastAssistant.content.filter((p: any) => p.type === 'tool-call');
          const allFulfilled = toolCalls.every((tc: any) =>
            messages.some(
              (m) => m.role === 'tool' && Array.isArray(m.content) && m.content.some((p) => p.type === 'tool-result' && p.toolCallId === tc.toolCallId),
            ),
          );

          if (allFulfilled) {
            const threadId = event.meta?.threadId || context.state.threadId;
            yield* runLLM(context, threadId);
          }
        }
      });

      builder.on('client:ui:widget:response', async function* (event, context) {
        const { metadata, values } = event.data;
        if (metadata?.type !== 'api_key_request') return;
        if (!values?.apiKey || !values?.provider || !values?.model) return;

        const provider = String(values.provider);
        const modelId = String(values.model).trim();
        const apiKey = String(values.apiKey);

        if (provider !== 'openai' && provider !== 'anthropic') {
          yield {
            type: 'agent:output',
            data: { content: `Unsupported provider: ${provider}` },
            meta: { agentId: context.state.agentId },
          };
          return;
        }

        const envVar = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
        const newModelString = `${provider}/${modelId}`;

        if (!storage) return;
        try {
          await storage.createVariable({ key: envVar, value: apiKey, secret: true });
          process.env[envVar] = apiKey;

          currentModelString = newModelString;
          model = resolveModel(currentModelString);
          try {
            saveConfig({ model: currentModelString });
          } catch {
            // best-effort: config persistence failure shouldn't block the conversation
          }

          yield {
            type: 'agent:output',
            data: {
              content: `Saved ${provider} API key and set model to \`${newModelString}\`.`,
            },
            meta: { agentId: context.state.agentId },
          };

          yield {
            type: 'client:ui:widget',
            data: {
              widgetId: event.data.widgetId,
              kind: 'message',
              title: 'API Key Saved',
              body: `Successfully saved ${provider} API key and selected model \`${newModelString}\`. You can now continue your conversation.`,
              state: 'submitted',
              actions: [{ id: 'ok', label: 'Got it', variant: 'primary' }],
            },
            meta: { agentId: context.state.agentId },
          };
        } catch (error) {
          yield {
            type: 'agent:output',
            data: {
              content: `Failed to save API key: ${error instanceof Error ? error.message : 'Unknown error'
                }`,
            },
            meta: { agentId: context.state.agentId },
          };
        }
      });
    };
