import { MelonyPlugin, RuntimeContext } from 'melony';
import { generateText, type LanguageModel } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { OpenBotEvent, OpenBotState, AgentInvokeEvent } from '../../app/types.js';
import { eventsToModelMessages } from './history.js';
import { Storage } from '../../services/plugins/domain.js';
import type { ToolDefinition } from '../../services/plugins/types.js';
import {
  ORCHESTRATOR_AGENT_ID,
  getContextBudgetForModel,
  buildContext,
} from './context.js';
import { saveConfig } from '../../app/config.js';
import { OPENBOT_SYSTEM_PROMPT } from './system-prompt.js';

export interface OpenBotRuntimeOptions {
  /** Provider model string (e.g. `openai/gpt-4o-mini`, `anthropic/claude-3-5-sonnet-20240620`). */
  model?: string;
  storage?: Storage;
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

async function buildSystemPrompt(
  state: OpenBotState,
  storage: Storage | undefined,
): Promise<string> {
  const context = await buildContext(state, storage);

  const instructions =
    state.agentId === ORCHESTRATOR_AGENT_ID
      ? (state.agentDetails?.instructions?.trim() || OPENBOT_SYSTEM_PROMPT)
      : OPENBOT_SYSTEM_PROMPT;

  return [
    instructions,
    '',
    context,
  ].join('\n');
}

/**
 * Tracks tool-call IDs from one LLM turn until matching `:result` events arrive.
 *
 * Melony runs yielded `action:*` events depth-first, so parallel tool calls from
 * a single `generateText` response execute one-by-one. We must wait for every ID
 * in the batch before calling the LLM again — not after the first result.
 */
function createToolBatchTracker() {
  let pending: Set<string> | null = null;

  return {
    startBatch(toolCallIds: string[]) {
      pending = new Set(toolCallIds);
    },
    clear() {
      pending = null;
    },
    /** Returns true when this result completes the batch (time to call the LLM again). */
    recordResult(toolCallId: string): boolean {
      if (!pending?.has(toolCallId)) return false;
      pending.delete(toolCallId);
      if (pending.size > 0) return false;
      pending = null;
      return true;
    },
  };
}

/**
 * OpenBot agent runtime.
 *
 * - One `generateText` call per `runLLM` (tools have no `execute`; SDK stops at 1 step).
 * - Tool calls become `action:*` events; plugins emit `:result` when done.
 * - When a full batch of results is in, `runLLM` runs again with updated history.
 */
export const openbotRuntime =
  (options: OpenBotRuntimeOptions): MelonyPlugin<OpenBotState, OpenBotEvent> =>
    (builder) => {
      const {
        model: modelString = 'openai/gpt-4o-mini',
        storage,
        toolDefinitions = {},
      } = options;

      let currentModelString = modelString;
      let model = resolveModel(currentModelString);
      const toolBatch = createToolBatchTracker();

      const runLLM = async function* (
        context: RuntimeContext<OpenBotState, OpenBotEvent>,
        threadId?: string,
        trigger?: AgentInvokeEvent,
      ): AsyncGenerator<OpenBotEvent> {
        if (!storage) return;

        // Capture parent metadata for event enrichment
        const triggerEvent = trigger || context.state.triggerEvent;
        const parentAgentId = triggerEvent?.meta?.parentAgentId;
        const parentToolCallId = triggerEvent?.meta?.parentToolCallId;

        context.state.model = currentModelString;

        const systemPrompt = await buildSystemPrompt(context.state, storage);

        const events = await storage.getEvents({
          channelId: context.state.channelId,
          threadId: context.state.threadId,
        });

        const messages = eventsToModelMessages(events);

        try {
          // Single LLM request — tool execution happens externally via action:* handlers.
          const result = await generateText({
            model,
            system: systemPrompt,
            messages,
            tools: toolDefinitions as Record<string, { description: string; inputSchema: any }>,
            stopWhen: ({ steps }) => steps.length === 1,
          });

          const toolCalls = result.toolCalls ?? [];

          // if (result.usage) {
          //   const usage = result.usage;
          //   yield {
          //     type: 'agent:usage',
          //     data: {
          //       usage: {
          //         promptTokens: usage.inputTokens,
          //         completionTokens: usage.outputTokens,
          //         totalTokens: usage.totalTokens,
          //         currentContextTokens: usage.inputTokens,
          //         contextBudget: getContextBudgetForModel(currentModelString),
          //       },
          //       model: currentModelString,
          //     },
          //     meta: {
          //       agentId: context.state.agentId,
          //       threadId,
          //       runId: context.state.runId,
          //     },
          //   } as OpenBotEvent;
          // }

          const outputMeta = {
            agentId: context.state.agentId,
            threadId,
            parentAgentId,
            parentToolCallId,
          };

          // Text before actions so history/UI show the model's intent first.
          if (result.text) {
            yield {
              type: 'agent:output',
              data: { content: result.text },
              meta: outputMeta,
            };
          }

          if (toolCalls.length > 0) {
            // when multiple tool calls are made, Melony runtime handles them one by one, thats why we need to start a new batch
            toolBatch.startBatch(toolCalls.map((tc) => tc.toolCallId));

            for (const toolCall of toolCalls) {
              yield {
                type: `action:${toolCall.toolName}` as OpenBotEvent['type'],
                data: toolCall.input,
                meta: {
                  toolCallId: toolCall.toolCallId,
                  ...outputMeta,
                },
              } as unknown as OpenBotEvent;
            }
          } else {
            // clear the tool batch if there are no tool calls
            toolBatch.clear();
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

        // clear the tool batch if the agent is invoked
        // this is to prevent the tool batch from being used for a new agent invocation
        toolBatch.clear();

        const threadId = event.meta?.threadId || context.state.threadId;
        yield* runLLM(context, threadId, event as AgentInvokeEvent);
      });

      // this is to handle the tool results from the tool calls
      // because Melony runtime handles them one by one, thats why we need to record the result
      builder.on('*', async function* (event, context) {
        if (!event.type.endsWith(':result')) return;
        if (event.meta?.agentId !== context.state.agentId) return;

        const toolCallId = event.meta?.toolCallId;
        // record the result of the tool call
        if (!toolCallId || !toolBatch.recordResult(toolCallId)) return;

        const threadId = event.meta?.threadId || context.state.threadId;
        yield* runLLM(context, threadId);
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
