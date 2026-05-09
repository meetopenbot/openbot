import { spawn, spawnSync } from 'node:child_process';
import type { MelonyPlugin } from 'melony';
import type { OpenBotEvent, OpenBotState } from '../../app/types.js';
import type { Storage } from '../../bus/types.js';

export interface GeminiCliRuntimeOptions {
  /** Gemini model id (e.g. `gemini-2.5-pro`, `gemini-2.5-flash`). */
  model?: string;
  /** Extra system prompt appended via the `--system-instruction` flag, if provided. */
  system?: string;
  /** Working directory for the CLI subprocess (falls back to channel cwd). */
  cwd?: string;
  /**
   * Path/name of the `gemini` binary. If unset (default), the runtime first
   * tries a `gemini` on PATH and falls back to
   * `npx -y @google/gemini-cli@<npmTag>`, which auto-installs on first run.
   */
  binary?: string;
  /** npm tag/version of `@google/gemini-cli` to use with the npx fallback. */
  npmTag?: string;
  /** Auto-approve all tool calls (`--yolo`). Use cautiously. */
  yolo?: boolean;
  /** Storage handle for persisting workspace variables (e.g. API key). */
  storage?: Storage;
}

/** Cached resolution of how to spawn Gemini CLI: either a direct binary or via npx. */
type SpawnTarget = { command: string; prefixArgs: string[] };
let cachedSpawnTarget: SpawnTarget | null = null;

const isBinaryOnPath = (bin: string): boolean => {
  try {
    const probe = spawnSync(bin, ['--version'], { stdio: 'ignore' });
    return probe.status === 0;
  } catch {
    return false;
  }
};

const resolveSpawnTarget = (
  explicitBinary: string | undefined,
  npmTag: string,
): SpawnTarget => {
  if (explicitBinary) {
    return { command: explicitBinary, prefixArgs: [] };
  }
  if (cachedSpawnTarget) return cachedSpawnTarget;

  const target: SpawnTarget = isBinaryOnPath('gemini')
    ? { command: 'gemini', prefixArgs: [] }
    : { command: 'npx', prefixArgs: ['-y', `@google/gemini-cli@${npmTag}`] };
  cachedSpawnTarget = target;
  return target;
};

const AUTH_ERROR_PATTERNS = [
    'api key',
    'apikey',
    'gemini_api_key',
    'google_api_key',
    'google_genai_use_vertexai',
    'google_genai_use_gca',
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
      widgetId: `gemini_cli_api_key_request_${Date.now()}`,
      title: 'Gemini API Key Required',
      description:
        `Gemini CLI could not authenticate (${reason}). ` +
        'Provide a Gemini API key to continue. The key is stored as a ' +
        'workspace variable on your machine and never leaves your local runtime.',
      fields: [
        {
          id: 'apiKey',
          label: 'API Key',
          type: 'text',
          placeholder: 'AIza...',
          required: true,
        },
      ],
      submitLabel: 'Save API Key',
      metadata: {
        type: 'api_key_request',
        provider: 'google',
        envVar: 'GEMINI_API_KEY',
        source: 'gemini-cli',
      },
    },
    meta: { agentId, threadId },
  }) as OpenBotEvent;

interface StreamEvent {
  type: string;
  role?: string;
  content?: string;
  delta?: boolean;
  message?: string;
  severity?: string;
  status?: string;
  error?: { type?: string; message?: string };
}

/**
 * Spawn `gemini` in headless mode (`-p` + `--output-format stream-json`) and
 * yield parsed JSONL events as they arrive. The child writes one JSON object
 * per line; we buffer partial lines.
 */
async function* runGeminiCli(
  args: string[],
  cwd: string | undefined,
  target: SpawnTarget,
): AsyncGenerator<{ event?: StreamEvent; stderr?: string; exit?: number }> {
  const child = spawn(target.command, [...target.prefixArgs, ...args], {
    cwd,
    env: {
      ...process.env,
      GEMINI_CLI_TRUST_WORKSPACE: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  let stderrBuf = '';
  const queue: Array<{ event?: StreamEvent; stderr?: string; exit?: number }> = [];
  let resolveNext: (() => void) | null = null;
  let done = false;

  const wake = () => {
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdoutBuf += chunk;
    let idx: number;
    while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as StreamEvent;
        queue.push({ event: parsed });
      } catch {
        queue.push({ stderr: line });
      }
    }
    wake();
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderrBuf += chunk;
    queue.push({ stderr: chunk });
    wake();
  });

  child.on('error', (err) => {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      queue.push({
        stderr:
          `[gemini-cli] failed to spawn "${target.command}": command not found. ` +
          `Install Node.js (for npx) or set the "binary" config to a valid gemini executable.`,
      });
    } else {
      queue.push({ stderr: String(err) });
    }
    done = true;
    wake();
  });

  child.on('close', (code) => {
    if (stdoutBuf.trim()) {
      try {
        queue.push({ event: JSON.parse(stdoutBuf.trim()) as StreamEvent });
      } catch {
        queue.push({ stderr: stdoutBuf });
      }
      stdoutBuf = '';
    }
    queue.push({ exit: code ?? 0 });
    done = true;
    wake();
  });

  while (true) {
    if (queue.length > 0) {
      const item = queue.shift()!;
      yield item;
      if (item.exit !== undefined) return;
      continue;
    }
    if (done) return;
    await new Promise<void>((resolve) => {
      resolveNext = resolve;
    });
  }
  void stderrBuf;
}

/**
 * Melony plugin that drives an agent backed by the `gemini` CLI in headless
 * mode (`gemini -p <prompt> --output-format stream-json`).
 *
 * Bus contract:
 *  - listens on `agent:invoke`
 *  - emits `agent:output` for assistant text turns and a final summary on error
 *
 * Note: Gemini CLI's headless mode does not currently expose a `resume` flag,
 * so each invocation starts a fresh session. Conversation continuity across
 * runs should be handled at the bus/orchestrator layer if needed.
 */
export const geminiCliRuntime =
  (options: GeminiCliRuntimeOptions = {}): MelonyPlugin<OpenBotState, OpenBotEvent> =>
  (builder) => {
    const {
      model,
      system,
      cwd,
      binary,
      npmTag = 'latest',
      yolo = false,
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
      const workingDir = cwd ?? context.state.channelDetails?.cwd;

      const args = ['--output-format', 'stream-json', '--skip-trust'];
      if (model) args.push('-m', model);
      if (yolo) args.push('--yolo');

      const fullPrompt = system ? `${system}\n\n${userContent}` : userContent;
      // Gemini CLI's headless mode takes the prompt as the `-p` argument value.
      // (Passing `-p -` would be interpreted literally as the string "-".)
      args.push('-p', fullPrompt);

      try {
        let authWidgetYielded = false;
        let assistantBuffer = '';
        let lastExitCode: number | undefined;
        let errorYielded = false;

        const flushAssistant = () => {
          const text = assistantBuffer;
          assistantBuffer = '';
          if (!text) return null;
          return {
            type: 'agent:output',
            data: { content: text },
            meta: { agentId: context.state.agentId, threadId },
          } as OpenBotEvent;
        };

        const target = resolveSpawnTarget(binary, npmTag);

        for await (const item of runGeminiCli(args, workingDir, target)) {
          if (item.exit !== undefined) {
            lastExitCode = item.exit;
            continue;
          }

          if (item.stderr && !authWidgetYielded) {
            if (isAuthErrorMessage(item.stderr)) {
              authWidgetYielded = true;
              yield buildApiKeyWidget(context.state.agentId, threadId, item.stderr.trim().slice(0, 200));
              return;
            }
            // Filter out noise to reduce distraction
            const filteredStderr = item.stderr
              .split('\n')
              .filter((line) => {
                const l = line.toLowerCase();
                if (l.includes('npm warn')) return false;
                if (l.includes('[STARTUP]')) return false;
                if (l.includes('ripgrep is not available')) return false;
                return true;
              })
              .join('\n')
              .trim();

            if (filteredStderr) {
              yield {
                type: 'agent:output',
                data: { content: `[gemini-cli] ${filteredStderr}` },
                meta: { agentId: context.state.agentId, threadId },
              };
            }
            continue;
          }

          const ev = item.event;
          if (!ev) continue;

          if (ev.type === 'message' && ev.role === 'assistant' && typeof ev.content === 'string') {
            if (ev.delta) {
              assistantBuffer += ev.content;
            } else {
              assistantBuffer += ev.content;
              const out = flushAssistant();
              if (out) yield out;
            }
            continue;
          }

          if (ev.type === 'error') {
            const msg = ev.message ?? ev.error?.message ?? 'unknown error';
            if (!authWidgetYielded && isAuthErrorMessage(msg)) {
              authWidgetYielded = true;
              yield buildApiKeyWidget(context.state.agentId, threadId, msg);
              return;
            }
            if (ev.severity === 'error') {
              errorYielded = true;
              yield {
                type: 'agent:output',
                data: { content: `[gemini-cli] ${msg}` },
                meta: { agentId: context.state.agentId, threadId },
              };
            }
            continue;
          }

          if (ev.type === 'result') {
            const out = flushAssistant();
            if (out) yield out;
            if (ev.status && ev.status !== 'success') {
              const msg = ev.error?.message ?? ev.status;
              if (!authWidgetYielded && isAuthErrorMessage(msg)) {
                authWidgetYielded = true;
                yield buildApiKeyWidget(context.state.agentId, threadId, msg);
                return;
              }
              errorYielded = true;
              yield {
                type: 'agent:output',
                data: { content: `[gemini-cli] run ended with error: ${msg}` },
                meta: { agentId: context.state.agentId, threadId },
              };
            }
          }
        }

        const tail = flushAssistant();
        if (tail) yield tail;

        if (lastExitCode !== undefined && lastExitCode !== 0 && !errorYielded && !authWidgetYielded) {
          yield {
            type: 'agent:output',
            data: { content: `[gemini-cli] process exited with code ${lastExitCode}` },
            meta: { agentId: context.state.agentId, threadId },
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (isAuthErrorMessage(errorMessage)) {
          yield buildApiKeyWidget(context.state.agentId, threadId, errorMessage);
          return;
        }
        yield {
          type: 'agent:output',
          data: { content: `[gemini-cli] error: ${errorMessage}` },
          meta: { agentId: context.state.agentId, threadId },
        };
      }
    });

    builder.on('client:ui:widget:response', async function* (event, context) {
      const { metadata, values, widgetId } = event.data ?? {};
      if (!metadata || metadata.type !== 'api_key_request') return;
      if (metadata.source !== 'gemini-cli') return;
      const apiKey = values?.apiKey;
      if (typeof apiKey !== 'string' || !apiKey) return;

      const envVar = typeof metadata.envVar === 'string' ? metadata.envVar : 'GEMINI_API_KEY';

      if (!storage) {
        yield {
          type: 'agent:output',
          data: { content: '[gemini-cli] no storage available; cannot persist API key.' },
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
              `Saved Gemini API key to workspace variables. Re-send your last message to retry.`,
          },
          meta: { agentId: context.state.agentId },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        yield {
          type: 'agent:output',
          data: { content: `[gemini-cli] failed to save API key: ${errorMessage}` },
          meta: { agentId: context.state.agentId },
        };
      }
    });
  };
