import type { MelonyPlugin } from 'melony';
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { OpenBotEvent, OpenBotState } from '../../app/types.js';
import type { Storage } from '../../bus/types.js';

export interface ClaudeCodeRuntimeOptions {
  /** Claude model alias or full id (e.g. `sonnet`, `claude-opus-4-5`). */
  model?: string;
  /** System prompt prepended to the SDK's default tools/system. */
  system?: string;
  /** Permission mode forwarded to the Claude Agent SDK. */
  permissionMode?: NonNullable<Options['permissionMode']>;
  /** Working directory for the SDK subprocess (falls back to channel cwd). */
  cwd?: string;
  /** Restrict the SDK's built-in tools (Read, Edit, Bash, ...). */
  allowedTools?: string[];
  /** Storage handle for persisting the resume session id across runs. */
  storage?: Storage;
}

interface PersistedClaudeState {
  claudeSessionId?: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const readPersistedSessionId = (state: OpenBotState): string | undefined => {
  const source = state.threadDetails?.state ?? state.channelDetails?.state;
  const record = asRecord(source) as PersistedClaudeState;
  return typeof record.claudeSessionId === 'string' ? record.claudeSessionId : undefined;
};

const persistSessionId = async (
  state: OpenBotState,
  storage: Storage | undefined,
  sessionId: string,
): Promise<void> => {
  if (!storage) return;
  const patch = { claudeSessionId: sessionId };
  if (state.threadId) {
    await storage.patchThreadState({
      channelId: state.channelId,
      threadId: state.threadId,
      state: patch,
    });
    return;
  }
  await storage.patchChannelState({ channelId: state.channelId, state: patch });
};

const AUTH_ERROR_PATTERNS = [
  'api key',
  'apikey',
  'anthropic_api_key',
  'authentication',
  'unauthorized',
  '401',
  'not logged in',
  'login',
  'oauth',
];

const isAuthErrorMessage = (message: string): boolean => {
  const lower = message.toLowerCase();
  return AUTH_ERROR_PATTERNS.some((p) => lower.includes(p));
};

const buildApiKeyWidget = (
  agentId: string,
  threadId: string | undefined,
  reason: string,
): OpenBotEvent =>
  ({
    type: 'client:ui:widget',
    data: {
      kind: 'form',
      widgetId: `claude_code_api_key_request_${Date.now()}`,
      title: 'Anthropic API Key Required',
      description:
        `Claude Code could not authenticate (${reason}). ` +
        'Provide an Anthropic API key to continue. The key is stored as a ' +
        'workspace variable on your machine and never leaves your local runtime.',
      fields: [
        {
          id: 'apiKey',
          label: 'API Key',
          type: 'text',
          placeholder: 'sk-ant-...',
          required: true,
        },
      ],
      submitLabel: 'Save API Key',
      metadata: {
        type: 'api_key_request',
        provider: 'anthropic',
        envVar: 'ANTHROPIC_API_KEY',
        source: 'claude-code',
      },
    },
    meta: { agentId, threadId },
  }) as OpenBotEvent;

const extractTextFromAssistantMessage = (msg: SDKMessage): string | null => {
  if (msg.type !== 'assistant') return null;
  const content = msg.message?.content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
      const text = (block as { text?: unknown }).text;
      if (typeof text === 'string' && text.length > 0) parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join('\n') : null;
};

/**
 * Melony plugin that drives an agent backed by `@anthropic-ai/claude-agent-sdk`.
 *
 * Bus contract:
 *  - listens on `agent:invoke`
 *  - emits `agent:output` for assistant text turns
 *  - persists the SDK's `session_id` so the next invocation can resume context
 *
 * The Claude Agent SDK runs its own tool loop (Read / Edit / Bash / ...), so we
 * do **not** bridge tool calls into the OpenBot event stream here. That keeps
 * this package self-contained and shippable as a standalone npm plugin.
 */
export const claudeCodeRuntime =
  (options: ClaudeCodeRuntimeOptions = {}): MelonyPlugin<OpenBotState, OpenBotEvent> =>
  (builder) => {
    const {
      model = 'sonnet',
      system,
      permissionMode = 'default',
      cwd,
      allowedTools,
      storage,
    } = options;

    builder.on('agent:invoke', async function* (event, context) {
      const routedTo = (event as { data?: { agentId?: string } }).data?.agentId;
      if (typeof routedTo === 'string' && routedTo && routedTo !== context.state.agentId) {
        return;
      }

      const userContent =
        typeof event.data?.content === 'string' ? event.data.content : '';
      if (!userContent) return;

      const threadId = event.meta?.threadId || context.state.threadId;
      const resumeId = readPersistedSessionId(context.state);
      const workingDir = cwd ?? context.state.channelDetails?.cwd;

      const sdkOptions: Options = {
        model,
        permissionMode,
        ...(system ? { systemPrompt: { type: 'preset', preset: 'claude_code', append: system } } : {}),
        ...(resumeId ? { resume: resumeId } : {}),
        ...(workingDir ? { cwd: workingDir } : {}),
        ...(allowedTools ? { allowedTools } : {}),
      };

      try {
        let lastSessionId: string | undefined = resumeId;
        let authWidgetYielded = false;

        for await (const message of query({ prompt: userContent, options: sdkOptions })) {
          if ('session_id' in message && typeof message.session_id === 'string') {
            lastSessionId = message.session_id;
          }

          if (
            !authWidgetYielded &&
            message.type === 'assistant' &&
            (message.error === 'authentication_failed' ||
              message.error === 'oauth_org_not_allowed')
          ) {
            authWidgetYielded = true;
            yield buildApiKeyWidget(context.state.agentId, threadId, message.error);
            return;
          }

          const text = extractTextFromAssistantMessage(message);
          if (text) {
            yield {
              type: 'agent:output',
              data: { content: text },
              meta: { agentId: context.state.agentId, threadId },
            };
          }

          if (message.type === 'result' && message.subtype !== 'success') {
            const subtype = (message as { subtype: string }).subtype;
            const resultText =
              'result' in message && typeof (message as { result?: unknown }).result === 'string'
                ? ((message as { result: string }).result)
                : '';
            if (!authWidgetYielded && (isAuthErrorMessage(subtype) || isAuthErrorMessage(resultText))) {
              authWidgetYielded = true;
              yield buildApiKeyWidget(context.state.agentId, threadId, subtype);
              return;
            }
            yield {
              type: 'agent:output',
              data: { content: `[claude-code] run ended with error: ${subtype}` },
              meta: { agentId: context.state.agentId, threadId },
            };
          }
        }

        if (lastSessionId && lastSessionId !== resumeId) {
          await persistSessionId(context.state, storage, lastSessionId);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (isAuthErrorMessage(errorMessage)) {
          yield buildApiKeyWidget(context.state.agentId, threadId, errorMessage);
          return;
        }
        yield {
          type: 'agent:output',
          data: { content: `[claude-code] error: ${errorMessage}` },
          meta: { agentId: context.state.agentId, threadId },
        };
      }
    });

    builder.on('client:ui:widget:response', async function* (event, context) {
      const { metadata, values, widgetId } = event.data ?? {};
      if (!metadata || metadata.type !== 'api_key_request') return;
      if (metadata.source !== 'claude-code') return;
      const apiKey = values?.apiKey;
      if (typeof apiKey !== 'string' || !apiKey) return;

      const envVar = typeof metadata.envVar === 'string' ? metadata.envVar : 'ANTHROPIC_API_KEY';

      if (!storage) {
        yield {
          type: 'agent:output',
          data: { content: '[claude-code] no storage available; cannot persist API key.' },
          meta: { agentId: context.state.agentId },
        };
        return;
      }

      try {
        await storage.createVariable({ key: envVar, value: apiKey, secret: true });
        process.env[envVar] = apiKey;

        yield {
          type: 'client:ui:widget',
          data: {
            widgetId,
            kind: 'message',
            title: 'API Key Saved',
            body: `Saved ${envVar} as a workspace variable. You can now continue the conversation.`,
            state: 'submitted',
            actions: [{ id: 'ok', label: 'Got it', variant: 'primary' }],
          },
          meta: { agentId: context.state.agentId },
        };

        yield {
          type: 'agent:output',
          data: {
            content:
              `Saved Anthropic API key to workspace variables. Re-send your last message to retry.`,
          },
          meta: { agentId: context.state.agentId },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        yield {
          type: 'agent:output',
          data: { content: `[claude-code] failed to save API key: ${errorMessage}` },
          meta: { agentId: context.state.agentId },
        };
      }
    });
  };
