import { MelonyPlugin } from 'melony';
import { z } from 'zod';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Plugin } from '../../services/plugins/types.js';
import { OpenBotEvent, OpenBotState } from '../../app/types.js';
import { resolvePath } from '../../app/config.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const FOREGROUND_DEV_TIMEOUT_MS = 5_000;
const TIMEOUT_EXIT_CODE = 124;
const MAX_LOG_CHARS = 32_000;
const DEFAULT_SESSION_ID = 'default';

const DEV_SERVER_READY_PATTERNS = [
  /\bready in \d+/i,
  /\blocal\s+https?:\/\//i,
  /\blistening on\b/i,
  /\bstarted server on\b/i,
  /\bwatching for file changes\b/i,
];

const isBackgroundedCommand = (command: string): boolean => {
  const trimmed = command.trim();
  return /\s&\s*$/.test(trimmed) || /\bnohup\b/.test(trimmed) || /\bdisown\b/.test(trimmed);
};

const looksLikeForegroundDevServer = (command: string): boolean => {
  const trimmed = command.trim();
  if (isBackgroundedCommand(trimmed)) return false;
  return (
    /\b(pnpm|npm|yarn|bun)\s+(run\s+)?dev\b/.test(trimmed) ||
    /\b(astro|vite|next|nuxt|remix)\s+dev\b/.test(trimmed) ||
    /\bpnpm\s+start\b/.test(trimmed) ||
    /\bnpm\s+run\s+start\b/.test(trimmed)
  );
};

const resolveExecTimeoutMs = (command: string): number =>
  looksLikeForegroundDevServer(command) ? FOREGROUND_DEV_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

const isDevServerReady = (output: string): boolean =>
  DEV_SERVER_READY_PATTERNS.some((pattern) => pattern.test(output));

const formatTimeoutOutput = (partialOutput: string, timeoutMs: number, ready: boolean): string => {
  const seconds = Math.round(timeoutMs / 1000);
  const statusLine = ready
    ? `[shell_exec timed out after ${seconds}s — process is still running and appears ready. Use shell_view to confirm the URL/port. Do not start a duplicate server.]`
    : `[shell_exec timed out after ${seconds}s — process may still be starting. Poll with shell_wait then shell_view until ready. Do not start a duplicate server.]`;
  const body = partialOutput.trim();
  return body ? `${body}\n\n${statusLine}` : statusLine;
};

type ExecResult = {
  exitCode: number;
  output: string;
  timedOut?: boolean;
  stillRunning?: boolean;
};

const shellToolDefinitions = {
  shell_exec: {
    description:
      'Execute a command in a stateful shell session. Blocks until the command exits. Foreground dev servers (e.g. `pnpm dev` without `&`) return after ~15s with output so far — poll with shell_wait/shell_view until ready. Prefer `pnpm dev &` to return immediately.',
    inputSchema: z.object({
      id: z
        .string()
        .describe('Shell session identifier (e.g. "default", "server"). Reuse ids to keep state.'),
      exec_dir: z
        .string()
        .describe('Working directory for this command (absolute path).'),
      command: z.string().describe('Shell command to execute.'),
    }),
  },
  shell_view: {
    description:
      'View recent output from a shell session. Use to poll dev-server logs after shell_exec times out or after backgrounding with `&`.',
    inputSchema: z.object({
      id: z.string().describe('Shell session identifier.'),
    }),
  },
  shell_wait: {
    description:
      'Wait N seconds, then return recent shell output. Use with shell_view to poll dev-server startup after shell_exec times out (e.g. shell_wait 3s, then shell_view, repeat until ready).',
    inputSchema: z.object({
      id: z.string().describe('Shell session identifier.'),
      seconds: z.number().int().min(1).max(300).describe('Seconds to wait.'),
    }),
  },
  shell_write_to_process: {
    description:
      'Write input to a running process in a shell session. Use to answer interactive prompts.',
    inputSchema: z.object({
      id: z.string().describe('Shell session identifier.'),
      input: z.string().describe('Input to send to the process.'),
      press_enter: z
        .boolean()
        .describe('Whether to press Enter after the input.'),
    }),
  },
  shell_kill_process: {
    description:
      'Send interrupt to the active process in a shell session (e.g. stop a dev server).',
    inputSchema: z.object({
      id: z.string().describe('Shell session identifier.'),
    }),
  },
};

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const resolveCwd = (context: { state: OpenBotState }, execDir?: string): string => {
  const raw =
    (typeof execDir === 'string' && execDir.trim()) ||
    context.state.channelDetails?.cwd ||
    process.cwd();
  return resolvePath(raw);
};

const sessionKey = (channelId: string, id: string) => `${channelId}:${id}`;

class ShellSession {
  private output = '';
  private process: ChildProcess | null = null;
  private execQueue: Promise<unknown> = Promise.resolve();
  private pending:
    | {
        marker: string;
        startLen: number;
        timeoutMs: number;
        resolve: (result: ExecResult) => void;
        reject: (error: Error) => void;
        timer: NodeJS.Timeout;
      }
    | undefined;

  constructor(
    readonly channelId: string,
    readonly id: string,
    readonly cwd: string,
  ) {
    this.spawn();
  }

  private spawn() {
    this.process = spawn('bash', [], {
      cwd: this.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (chunk: Buffer) => this.append(chunk.toString()));
    this.process.stderr?.on('data', (chunk: Buffer) => this.append(chunk.toString()));
    this.process.on('exit', () => {
      this.process = null;
      this.rejectPending(new Error('Shell session exited unexpectedly'));
    });
    this.process.on('error', (error) => {
      this.rejectPending(error);
    });
  }

  private rejectPending(error: Error) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(error);
    this.pending = undefined;
  }

  private append(chunk: string) {
    this.output += chunk;
    if (this.output.length > MAX_LOG_CHARS) {
      this.output = this.output.slice(-MAX_LOG_CHARS);
    }

    if (!this.pending) return;
    const tail = this.output.slice(this.pending.startLen);
    const markerIndex = tail.indexOf(this.pending.marker);
    if (markerIndex === -1) return;

    const afterMarker = tail.slice(markerIndex + this.pending.marker.length);
    const match = afterMarker.match(/^:(\d+)/);
    const exitCode = match ? Number.parseInt(match[1], 10) : 0;
    const output = tail.slice(0, markerIndex).trimEnd();

    clearTimeout(this.pending.timer);
    this.pending.resolve({ exitCode, output });
    this.pending = undefined;
  }

  private ensureProcess() {
    if (!this.process?.stdin) {
      this.spawn();
    }
    if (!this.process?.stdin) {
      throw new Error('Failed to start shell session');
    }
    return this.process;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.execQueue.then(fn, fn);
    this.execQueue = next.catch(() => undefined);
    return next;
  }

  view(): string {
    return this.output.slice(-8000);
  }

  async exec(command: string, execDir: string): Promise<ExecResult> {
    return this.enqueue(() => this.execInternal(command, execDir));
  }

  private execInternal(command: string, execDir: string): Promise<ExecResult> {
    const process = this.ensureProcess();
    const marker = `__OPENBOT_${randomUUID().replace(/-/g, '')}__`;
    const script = `cd ${shellQuote(execDir)} && ${command}; printf '\\n${marker}:%s\\n' "$?"`;
    const timeoutMs = resolveExecTimeoutMs(command);

    return new Promise((resolve, reject) => {
      if (this.pending) {
        reject(new Error('Shell session is busy'));
        return;
      }

      const startLen = this.output.length;
      const timer = setTimeout(() => {
        if (!this.pending) return;
        const { startLen: pendingStartLen, timeoutMs: pendingTimeoutMs, resolve: pendingResolve } =
          this.pending;
        clearTimeout(this.pending.timer);
        this.pending = undefined;

        const partial = this.output.slice(pendingStartLen).trimEnd();
        const ready = isDevServerReady(partial);
        pendingResolve({
          exitCode: TIMEOUT_EXIT_CODE,
          output: formatTimeoutOutput(partial, pendingTimeoutMs, ready),
          timedOut: true,
          stillRunning: true,
        });
      }, timeoutMs);

      this.pending = { marker, startLen, timeoutMs, resolve, reject, timer };

      try {
        process.stdin!.write(`${script}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending = undefined;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async wait(seconds: number): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return this.view();
  }

  write(input: string, pressEnter: boolean) {
    const process = this.ensureProcess();
    process.stdin!.write(pressEnter ? `${input}\n` : input);
  }

  kill() {
    const process = this.ensureProcess();
    process.stdin!.write('\x03');
  }

  destroy() {
    this.rejectPending(new Error('Shell session closed'));
    if (!this.process) return;
    try {
      this.process.kill('SIGTERM');
    } catch {
      // ignore
    }
    this.process = null;
  }
}

const sessions = new Map<string, ShellSession>();

const getSession = (
  channelId: string,
  id: string,
  defaultCwd: string,
): ShellSession => {
  const key = sessionKey(channelId, id);
  const existing = sessions.get(key);
  if (existing) return existing;

  const session = new ShellSession(channelId, id, defaultCwd);
  sessions.set(key, session);
  return session;
};

const destroySessionsForChannel = (channelId: string) => {
  for (const [key, session] of sessions.entries()) {
    if (!key.startsWith(`${channelId}:`)) continue;
    session.destroy();
    sessions.delete(key);
  }
};

const formatResult = (output: string, extra?: Record<string, unknown>) => ({
  success: true,
  output: output.trim() || '(no output)',
  ...extra,
});

const resolveShellWidgetId = (event: OpenBotEvent): string =>
  event.meta?.toolCallId || randomUUID();

const formatShellWidgetBody = (
  input: Record<string, unknown>,
  output: string,
): string => {
  const inputText = JSON.stringify(input, null, 2);
  const outputText = output.trim() || '(no output)';
  return `Input:\n${inputText}\n\nOutput:\n${outputText}`;
};

function* emitShellWidgetPending(
  event: OpenBotEvent,
  context: { state: OpenBotState },
  tool: string,
  input: Record<string, unknown>,
  widgetId: string,
): Generator<OpenBotEvent> {
  const threadId = event.meta?.threadId || context.state.threadId;

  yield {
    type: 'client:ui:widget',
    data: {
      widgetId,
      kind: 'message',
      title: tool,
      body: formatShellWidgetBody(input, '(running...)'),
      display: 'collapsed',
      metadata: {
        type: 'shell:tool',
        tool,
        input,
        status: 'running',
      },
    },
    meta: { agentId: context.state.agentId, threadId },
  } as OpenBotEvent;
}

function* emitShellToolResult(
  event: OpenBotEvent,
  context: { state: OpenBotState },
  tool: string,
  input: Record<string, unknown>,
  result: { success: boolean; output: string; [key: string]: unknown },
  widgetId: string,
): Generator<OpenBotEvent> {
  const threadId = event.meta?.threadId || context.state.threadId;
  const output = String(result.output ?? '');

  yield {
    type: 'client:ui:widget',
    data: {
      widgetId,
      kind: 'message',
      title: tool,
      body: formatShellWidgetBody(input, output),
      state: result.success ? 'submitted' : 'error',
      display: 'collapsed',
      metadata: {
        type: 'shell:tool',
        tool,
        input,
        output,
        success: result.success,
        status: result.success ? 'done' : 'error',
      },
    },
    meta: { agentId: context.state.agentId, threadId },
  } as OpenBotEvent;

  const { output: _output, ...resultData } = result;
  yield {
    type: `action:${tool}:result` as OpenBotEvent['type'],
    data: { ...resultData, output },
    meta: event.meta,
  } as OpenBotEvent;
}

async function* runShellTool(
  event: OpenBotEvent,
  context: { state: OpenBotState },
  tool: string,
  input: Record<string, unknown>,
  execute: () => Promise<{ success: boolean; output: string; [key: string]: unknown }>,
): AsyncGenerator<OpenBotEvent> {
  const widgetId = resolveShellWidgetId(event);
  yield* emitShellWidgetPending(event, context, tool, input, widgetId);

  try {
    const result = await execute();
    yield* emitShellToolResult(event, context, tool, input, result, widgetId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown shell error';
    yield* emitShellToolResult(
      event,
      context,
      tool,
      input,
      { success: false, output: message, error: message },
      widgetId,
    );
  }
}

const shellPluginRuntime = (): MelonyPlugin<OpenBotState, OpenBotEvent> => (builder) => {
  builder.on('action:shell_exec', async function* (event, context) {
    const { id, exec_dir, command } = event.data as {
      id?: string;
      exec_dir?: string;
      command?: string;
    };
    const sessionId = (id || DEFAULT_SESSION_ID).trim() || DEFAULT_SESSION_ID;
    const channelId = context.state.channelId;

    const input = {
      id: sessionId,
      exec_dir: exec_dir ?? resolveCwd(context),
      command: command ?? '',
    };

    if (!command?.trim()) {
      yield* runShellTool(event, context, 'shell_exec', input, async () => ({
        success: false,
        output: 'command is required',
      }));
      return;
    }

    yield* runShellTool(event, context, 'shell_exec', input, async () => {
      const execDir = resolveCwd(context, exec_dir);
      const session = getSession(channelId, sessionId, execDir);
      const result = await session.exec(command, execDir);
      const success = result.timedOut ? isDevServerReady(result.output) : result.exitCode === 0;
      return {
        success,
        exitCode: result.exitCode,
        output: result.output.trim() || '(no output)',
        ...(result.timedOut && { timedOut: true, stillRunning: result.stillRunning }),
      };
    });
  });

  builder.on('action:shell_view', async function* (event, context) {
    const sessionId = ((event.data as { id?: string })?.id || DEFAULT_SESSION_ID).trim();
    const channelId = context.state.channelId;
    const defaultCwd = resolveCwd(context);
    const input = { id: sessionId };

    yield* runShellTool(event, context, 'shell_view', input, async () => {
      const session = getSession(channelId, sessionId, defaultCwd);
      return formatResult(session.view());
    });
  });

  builder.on('action:shell_wait', async function* (event, context) {
    const { id, seconds } = event.data as { id?: string; seconds?: number };
    const sessionId = (id || DEFAULT_SESSION_ID).trim();
    const channelId = context.state.channelId;
    const defaultCwd = resolveCwd(context);
    const waitedSeconds = seconds ?? 5;
    const input = { id: sessionId, seconds: waitedSeconds };

    yield* runShellTool(event, context, 'shell_wait', input, async () => {
      const session = getSession(channelId, sessionId, defaultCwd);
      const output = await session.wait(waitedSeconds);
      return formatResult(output, { waitedSeconds });
    });
  });

  builder.on('action:shell_write_to_process', async function* (event, context) {
    const { id, input: textInput, press_enter } = event.data as {
      id?: string;
      input?: string;
      press_enter?: boolean;
    };
    const sessionId = (id || DEFAULT_SESSION_ID).trim();
    const channelId = context.state.channelId;
    const defaultCwd = resolveCwd(context);

    const toolInput = {
      id: sessionId,
      input: textInput ?? '',
      press_enter: press_enter ?? true,
    };

    if (!textInput?.trim()) {
      yield* runShellTool(event, context, 'shell_write_to_process', toolInput, async () => ({
        success: false,
        output: 'input is required',
      }));
      return;
    }

    yield* runShellTool(event, context, 'shell_write_to_process', toolInput, async () => {
      const session = getSession(channelId, sessionId, defaultCwd);
      session.write(textInput, toolInput.press_enter);
      return { success: true, output: 'Input sent to shell session.' };
    });
  });

  builder.on('action:shell_kill_process', async function* (event, context) {
    const sessionId = ((event.data as { id?: string })?.id || DEFAULT_SESSION_ID).trim();
    const channelId = context.state.channelId;
    const defaultCwd = resolveCwd(context);
    const input = { id: sessionId };

    yield* runShellTool(event, context, 'shell_kill_process', input, async () => {
      const session = getSession(channelId, sessionId, defaultCwd);
      session.kill();
      return { success: true, output: 'Interrupt sent to shell session.' };
    });
  });

  builder.on('action:delete_channel', async function* (event) {
    const channelId = (event.data as { channelId?: string })?.channelId;
    if (channelId) {
      destroySessionsForChannel(channelId);
    }
  });
};

export const bashPlugin: Plugin = {
  id: 'bash',
  name: 'Shell',
  description: 'Stateful shell sessions for the channel workspace (Manus-style).',
  toolDefinitions: shellToolDefinitions,
  factory: () => shellPluginRuntime(),
};

export default bashPlugin;
