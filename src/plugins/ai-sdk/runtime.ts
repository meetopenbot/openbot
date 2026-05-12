import { MelonyPlugin, RuntimeContext } from 'melony';
import { generateText, type LanguageModel, type ModelMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { OpenBotEvent, OpenBotState, ShortTermMessage } from '../../app/types.js';
import { Storage } from '../../bus/types.js';
import type { ToolDefinition } from '../../bus/plugin.js';
import { createDefaultContextEngine } from '../../harness/context.js';
import { saveConfig } from '../../app/config.js';

export interface AiSdkRuntimeOptions {
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

/**
 * Trim the message history to a sliding window while preserving tool-call
 * integrity. Drops any leading orphan `tool` messages whose matching
 * assistant call was sliced off, since most providers reject that.
 */
const buildMessageWindow = (messages: ShortTermMessage[]): ShortTermMessage[] => {
  if (messages.length <= MAX_WINDOW_MESSAGES) return messages;
  const tail = messages.slice(-MAX_WINDOW_MESSAGES);
  const knownAssistantCallIds = new Set<string>();
  for (const m of tail) {
    if (m.role === 'assistant' && m.toolCalls) {
      for (const tc of m.toolCalls) knownAssistantCallIds.add(tc.id);
    }
  }
  return tail.filter((m) => m.role !== 'tool' || knownAssistantCallIds.has(m.toolCallId));
};

/**
 * Self-healing pass: every assistant tool_call must have a matching tool
 * result before the next user/assistant turn, or providers (OpenAI in
 * particular) reject the request with "Tool result is missing for tool call".
 *
 * This can happen when a handler emits a `:result` event without `meta`
 * (orphaning the call), the process restarts mid-run, or a tool handler
 * crashes. Rather than refuse to continue, we inject synthetic tool messages
 * with a clear error payload — the LLM can then explain the failure to the
 * user and proceed.
 */
const repairOpenToolCalls = (messages: ShortTermMessage[]): ShortTermMessage[] => {
  const fulfilled = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool') fulfilled.add(m.toolCallId);
  }

  const repaired: ShortTermMessage[] = [];
  for (const m of messages) {
    repaired.push(m);
    if (m.role !== 'assistant' || !m.toolCalls) continue;
    for (const tc of m.toolCalls) {
      if (fulfilled.has(tc.id)) continue;
      repaired.push({
        role: 'tool',
        toolCallId: tc.id,
        toolName: tc.function.name,
        content: JSON.stringify({
          success: false,
          error: 'Tool result was lost (handler did not emit a matching :result event).',
        }),
      });
      fulfilled.add(tc.id);
    }
  }
  return repaired;
};

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
  storage: Storage | undefined,
  contextEngine: {
    buildContext: (state: OpenBotState, storage?: Storage) => Promise<string>;
  },
): Promise<string> {
  return contextEngine.buildContext(state, storage);
}

/**
 * Generic ai-sdk runtime plugin.
 *
 * Owns `agent:invoke`, runs the LLM, emits tool-call events, and stitches tool
 * results back into the conversation. Tools are supplied externally by the
 * loader (merged from every tool plugin attached to the same agent).
 */
export const aiSdkRuntime =
  (options: AiSdkRuntimeOptions): MelonyPlugin<OpenBotState, OpenBotEvent> =>
    (builder) => {
      const {
        model: modelString = 'openai/gpt-4o-mini',
        storage,
        contextEngine = createDefaultContextEngine(),
        toolDefinitions = {},
      } = options;

      let currentModelString = modelString;
      let model = resolveModel(currentModelString);

      const ensureShortTermMessages = (state: OpenBotState) => {
        if (!state.shortTermMessages || state.shortTermMessages.length === 0) {
          state.shortTermMessages = readPersistedShortTermMessages(state);
        }
      };

      const mapToCoreMessages = (messages: ShortTermMessage[]): ModelMessage[] => {
        return messages.map((m): ModelMessage => {
          if (m.role === 'assistant' && m.toolCalls) {
            return {
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
            };
          }
          if (m.role === 'assistant') {
            return { role: 'assistant', content: m.content || '' };
          }
          if (m.role === 'tool') {
            return {
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolCallId: m.toolCallId,
                  toolName: m.toolName,
                  output: { type: 'text', value: JSON.stringify(m.content) },
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
        const systemPrompt = await buildSystemPrompt(context.state, storage, contextEngine);

        const coreMessages = mapToCoreMessages(
          buildMessageWindow(repairOpenToolCalls(context.state.shortTermMessages || [])),
        );

        console.log('systemPrompt', systemPrompt);

        console.log('coreMessages', JSON.stringify(coreMessages, null, 2));

        try {
          const result = await generateText({
            model,
            system: systemPrompt,
            messages: coreMessages,
            tools: toolDefinitions as Record<string, { description: string; inputSchema: any }>,
          });

          const toolCalls = result.toolCalls ?? [];

          if (toolCalls.length > 0) {
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

        ensureShortTermMessages(context.state);
        context.state.shortTermMessages = [
          ...(context.state.shortTermMessages ?? []),
          {
            role: event.data?.role || 'user',
            content: event?.data?.content || '',
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

        const toolName = event.type.replace(/^action:/, '').replace(/:result$/, '');
        const resultData = (event as { data?: unknown }).data;
        const content = truncateToolPayload(resultData);

        context.state.shortTermMessages = [
          ...(context.state.shortTermMessages ?? []),
          { role: 'tool', content, toolCallId, toolName },
        ];
        await persistShortTermMessages(context.state, storage);

        const lastAssistant = [...(context.state.shortTermMessages ?? [])]
          .reverse()
          .find(
            (m): m is Extract<ShortTermMessage, { role: 'assistant' }> =>
              m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0,
          );

        if (lastAssistant && lastAssistant.toolCalls) {
          const allFulfilled = lastAssistant.toolCalls.every((tc) =>
            context.state.shortTermMessages?.some(
              (m) => m.role === 'tool' && m.toolCallId === tc.id,
            ),
          );

          if (allFulfilled) {
            if (toolName === 'handoff') return;
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
