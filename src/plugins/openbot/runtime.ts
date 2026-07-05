import { MelonyPlugin, RuntimeContext } from 'melony';
import { generateText } from 'ai';
import { OpenBotEvent, OpenBotState, AgentInvokeEvent } from '../../app/types.js';
import { eventsToModelMessages } from './history.js';
import { Storage } from '../../services/plugins/domain.js';
import type { ToolDefinition } from '../../services/plugins/types.js';
import { buildContext } from './context.js';
import { saveConfig } from '../../app/config.js';
import { isCloudSystemAgent } from '../../app/cloud-mode.js';
import { OPENBOT_SYSTEM_PROMPT } from './system-prompt.js';
import { resolveModel } from './model.js';
import {
  listApiKeyProvidersFromRegistry,
  resolveModelRegistry,
} from '../../services/plugins/model-registry.js';

export interface OpenBotRuntimeOptions {
  /** Provider model string (e.g. `openai/gpt-4o-mini`, `anthropic/claude-3-5-sonnet-20240620`). */
  model?: string;
  agentId?: string;
  storage?: Storage;
  /** Tool definitions merged from all tool plugins attached to this agent. */
  toolDefinitions?: Record<string, ToolDefinition>;
  /** Fires when the run is stopped; cancels the in-flight LLM call. */
  abortSignal?: AbortSignal;
}

async function buildSystemPrompt(
  state: OpenBotState,
  storage: Storage | undefined,
): Promise<string> {
  const context = await buildContext(state, storage);

  const sections = [OPENBOT_SYSTEM_PROMPT, '', context];

  // Hardcoded naming hint logic
  const threadState = state.threadDetails?.state as any;
  if (!threadState?.isSmartNamed) {
    sections.push(
      '',
      '## SYSTEM HINT',
      'This thread is unnamed. Please use the `patch_thread_details` tool to set a concise, descriptive, and regular `name` (e.g., "Project Brainstorming" instead of "project-brainstorm") in the thread state and set `isSmartNamed: true` in the same patch. Only do this once.',
    );
  }

  return sections.join('\n');
}

/**
 * Tracks tool-call IDs from one LLM turn until matching `:result` events arrive.
 *
 * Melony runs yielded `action:*` events depth-first, so parallel tool calls from
 * a single `generateText` response execute one-by-one. We must wait for every ID
 * in the batch before calling the LLM again — not after the first result.
 */
function createToolBatchTracker(
  state: OpenBotState,
  storage?: Storage,
  channelId?: string,
  threadId?: string,
) {
  const save = async (ids?: string[]) => {
    if (!storage || !channelId || !threadId) return;
    try {
      await storage.patchThreadState({
        channelId,
        threadId,
        state: { pendingToolCallIds: ids },
      });
    } catch (error) {
      console.error('[openbot] Failed to persist pendingToolCallIds:', error);
    }
  };

  return {
    async startBatch(toolCallIds: string[]) {
      state.pendingToolCallIds = [...toolCallIds];
      await save(state.pendingToolCallIds);
    },
    async clear() {
      state.pendingToolCallIds = undefined;
      await save(undefined);
    },
    /** Returns true when this result completes the batch (time to call the LLM again). */
    async recordResult(toolCallId: string): Promise<boolean> {
      if (!state.pendingToolCallIds?.includes(toolCallId)) return false;
      state.pendingToolCallIds = state.pendingToolCallIds.filter((id) => id !== toolCallId);
      const done = state.pendingToolCallIds.length === 0;
      if (done) {
        state.pendingToolCallIds = undefined;
      }
      await save(state.pendingToolCallIds);
      return done;
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
        agentId,
        storage,
        toolDefinitions = {},
        abortSignal,
      } = options;

      let currentModelString = modelString;
      let model = resolveModel(currentModelString, agentId);

      const runLLM = async function* (
        context: RuntimeContext<OpenBotState, OpenBotEvent>,
        threadId?: string,
        trigger?: AgentInvokeEvent,
      ): AsyncGenerator<OpenBotEvent> {
        if (!storage) return;
        if (abortSignal?.aborted) return;

        const toolBatch = createToolBatchTracker(
          context.state,
          storage,
          context.state.channelId,
          threadId || context.state.threadId,
        );

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

        // console.log('systemPrompt:::::::\n', systemPrompt);
        // console.log('messages:::::::\n', JSON.stringify(messages));
        // console.log('toolDefinitions:::::::\n', JSON.stringify(toolDefinitions));

        try {
          // Single LLM request — tool execution happens externally via action:* handlers.
          const result = await generateText({
            model,
            system: systemPrompt,
            messages,
            tools: toolDefinitions as Record<string, { description: string; inputSchema: any }>,
            stopWhen: ({ steps }) => steps.length === 1,
            allowSystemInMessages: true,
            abortSignal,
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
            await toolBatch.startBatch(toolCalls.map((tc) => tc.toolCallId));

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
            await toolBatch.clear();
          }
        } catch (error: unknown) {
          // Run was stopped — unwind quietly without surfacing an error.
          if (abortSignal?.aborted) return;

          const errorMessage = error instanceof Error ? error.message : String(error);
          const isApiKeyError =
            errorMessage.includes('API key') ||
            errorMessage.includes('401') ||
            errorMessage.includes('Unauthorized') ||
            errorMessage.includes('authentication');

          if (isApiKeyError && !isCloudSystemAgent(context.state.agentId)) {
            const registry = await resolveModelRegistry();
            const providerActions = listApiKeyProvidersFromRegistry(registry).map((provider) => ({
              id: provider.id,
              label: provider.label,
              variant: 'primary' as const,
            }));

            yield {
              type: 'client:ui:widget',
              data: {
                kind: 'choice',
                widgetId: `api_provider_selection_${Date.now()}`,
                title: `Setup AI Provider`,
                description: `Select a provider to continue.`,
                actions:
                  providerActions.length > 0
                    ? providerActions
                    : [
                        { id: 'openai', label: 'OpenAI', variant: 'primary' as const },
                        { id: 'anthropic', label: 'Anthropic', variant: 'primary' as const },
                        { id: 'google', label: 'Google', variant: 'primary' as const },
                      ],
                metadata: {
                  type: 'api_provider_selection',
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

        // Capture user info from meta if available
        if (event.meta?.userName) {
          context.state.currentUser = {
            userName: event.meta.userName,
          };
        }

        const threadId = event.meta?.threadId || context.state.threadId;

        // clear the tool batch if the agent is invoked
        // this is to prevent the tool batch from being used for a new agent invocation
        await createToolBatchTracker(
          context.state,
          storage,
          context.state.channelId,
          threadId,
        ).clear();

        yield* runLLM(context, threadId, event as AgentInvokeEvent);
      });

      // this is to handle the tool results from the tool calls
      // because Melony runtime handles them one by one, thats why we need to record the result
      builder.on('*', async function* (event, context) {
        if (!event.type.endsWith(':result')) return;
        if (event.meta?.agentId !== context.state.agentId) return;

        const toolCallId = event.meta?.toolCallId;
        // record the result of the tool call
        if (
          !toolCallId ||
          !(await createToolBatchTracker(
            context.state,
            storage,
            context.state.channelId,
            event.meta?.threadId || context.state.threadId,
          ).recordResult(toolCallId))
        )
          return;

        const threadId = event.meta?.threadId || context.state.threadId;
        yield* runLLM(context, threadId);
      });

      builder.on('client:ui:widget:response', async function* (event, context) {
        const { metadata, values, actionId } = event.data;
        const threadId = event.meta?.threadId || context.state.threadId;

        if (isCloudSystemAgent(context.state.agentId)) return;

        if (metadata?.type === 'api_provider_selection') {
          const provider = actionId;
          const [_, ...rest] = currentModelString.split('/');
          const currentModelId = rest.join('/');

          const registry = await resolveModelRegistry();
          const providerData = registry.providers?.[provider as string];

          const providerLinks: Record<string, string> = {
            openai: 'https://platform.openai.com/api-keys',
            anthropic: 'https://console.anthropic.com/settings/keys',
            google: 'https://aistudio.google.com/app/apikey',
          };

          const label = providerData?.label || (provider as string);
          const link = providerLinks[provider as string] || '';

          const modelOptions = providerData?.models.map((m) => ({
            label: m.label,
            value: m.id,
          }));

          if (!modelOptions || modelOptions.length === 0) {
            yield {
              type: 'agent:output',
              data: {
                content: `No models are listed for **${label}** in the marketplace registry.`,
              },
              meta: { agentId: context.state.agentId },
            };
            return;
          }

          const defaultModel = modelOptions[0].value;
          const defaultValue =
            modelOptions.find((m) => m.value === currentModelId)?.value || defaultModel;

          yield {
            type: 'client:ui:widget',
            data: {
              widgetId: event.data.widgetId,
              kind: 'message',
              title: 'Provider Selected',
              body: `${label} provider was selected.`,
              state: 'submitted',
              display: 'collapsed',
              disabled: true,
              actions: [],
            },
            meta: { agentId: context.state.agentId, threadId },
          } as OpenBotEvent;

          yield {
            type: 'client:ui:widget',
            data: {
              kind: 'form',
              widgetId: `api_key_request_${Date.now()}`,
              title: `${label} Setup`,
              description: `Enter your API key and select a model.`,
              fields: [
                {
                  id: 'model',
                  label: 'Model',
                  type: 'select',
                  options: modelOptions,
                  required: true,
                  defaultValue,
                },
                {
                  id: 'apiKey',
                  label: 'API Key',
                  type: 'password',
                  description: `Get your key here: [${link}](${link})`,
                  placeholder: `sk-...`,
                  required: true,
                },
              ],
              submitLabel: 'Save & Continue',
              metadata: {
                type: 'api_key_request',
                provider,
              },
            },
            meta: { agentId: context.state.agentId, threadId },
          } as OpenBotEvent;
          return;
        }

        if (metadata?.type !== 'api_key_request') return;
        if (!values?.apiKey || !values?.model) return;

        const provider = String(values.provider || metadata.provider);
        const modelId = String(values.model).trim();
        const apiKey = String(values.apiKey);

        if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'google') {
          yield {
            type: 'agent:output',
            data: { content: `Unsupported provider: ${provider}` },
            meta: { agentId: context.state.agentId },
          };
          return;
        }

        const envVar =
          provider === 'openai'
            ? 'OPENAI_API_KEY'
            : provider === 'anthropic'
              ? 'ANTHROPIC_API_KEY'
              : 'GOOGLE_GENERATIVE_AI_API_KEY';
        const newModelString = `${provider}/${modelId}`;

        if (!storage) return;
        try {
          await storage.createVariable({ key: envVar, value: apiKey, secret: true });
          process.env[envVar] = apiKey;

          currentModelString = newModelString;
          model = resolveModel(currentModelString, agentId);
          try {
            saveConfig({ model: currentModelString });

            // Also update the agent's AGENT.md if it has an openbot plugin config
            const details = await storage.getAgentDetails({ agentId: context.state.agentId });
            const updatedPlugins = details.pluginRefs.map((ref) => {
              if (ref.id === 'openbot') {
                return {
                  ...ref,
                  config: { ...ref.config, model: currentModelString },
                };
              }
              return ref;
            });

            await storage.updateAgent({
              agentId: context.state.agentId,
              plugins: updatedPlugins,
            });
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
              display: 'collapsed',
              disabled: true,
              actions: [],
            },
            meta: { agentId: context.state.agentId },
          };

          yield* runLLM(context, threadId);
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
