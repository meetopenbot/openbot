import { MelonyPlugin } from 'melony';
import { z } from 'zod';
import { spawn, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Plugin } from '../../services/plugins/types.js';
import { OpenBotEvent, OpenBotState } from '../../app/types.js';
import { resolvePath } from '../../app/config.js';

const bashToolDefinitions = {
  bash: {
    description:
      'Execute a bash command in a stateful session. The working directory and environment variables persist between calls. Use this for all system tasks, file operations, and running development servers.',
    inputSchema: z.object({
      command: z.string().describe('The bash command to execute.'),
      restart: z
        .boolean()
        .optional()
        .describe('Restart the bash session before running the command.'),
    }),
  },
  bash_stop: {
    description: 'Stop the bash session for the current or specified channel.',
    inputSchema: z.object({
      channelId: z.string().optional().describe('The channel ID to stop the session for.'),
    }),
  },
  bash_list_sessions: {
    description: 'List all active bash sessions.',
    inputSchema: z.object({}),
  },
};

interface BashSession {
  process: ChildProcess;
  cwd: string;
  lastActivity: number;
}

const sessions = new Map<string, BashSession>();

const getSession = (channelId: string, initialCwd: string): BashSession => {
  let session = sessions.get(channelId);
  if (!session) {
    const childProcess = spawn('bash', ['--login'], {
      cwd: initialCwd,
      env: { ...process.env, PS1: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    session = {
      process: childProcess,
      cwd: initialCwd,
      lastActivity: Date.now(),
    };
    sessions.set(channelId, session);

    // Basic error handling for the process
    childProcess.on('error', (err: Error) => {
      console.error(`[bash] Session error for channel ${channelId}:`, err);
      sessions.delete(channelId);
    });

    childProcess.on('exit', () => {
      sessions.delete(channelId);
    });
  }
  return session;
};

const bashPluginRuntime = (): MelonyPlugin<OpenBotState, OpenBotEvent> => (builder) => {
  builder.on('action:bash', async function* (event, context) {
    const { command, restart } = event.data;
    const channelId = context.state.channelId;
    const initialCwd = resolvePath(context.state.channelDetails?.cwd || process.cwd());

    if (restart) {
      const oldSession = sessions.get(channelId);
      if (oldSession) {
        oldSession.process.kill();
        sessions.delete(channelId);
      }
    }

    const session = getSession(channelId, initialCwd);
    session.lastActivity = Date.now();

    try {
      const result = await new Promise<{
        exitCode: number | null;
        stdout: string;
        stderr: string;
        timedOut: boolean;
      }>((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const sentinel = `__OPENBOT_BASH_DONE_${Math.random().toString(36).substring(7)}__`;

        const timeoutMs = 60000; // 1 minute timeout for tool calls
        const timer = setTimeout(() => {
          timedOut = true;
          // We don't kill the session on timeout, just return what we have
          resolve({ exitCode: null, stdout, stderr, timedOut });
        }, timeoutMs);

        const onStdout = (data: Buffer) => {
          const str = data.toString();
          if (str.includes(sentinel)) {
            const parts = str.split(sentinel);
            stdout += parts[0];
            const exitCodeMatch = parts[1].match(/EXIT:(\d+)/);
            const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : 0;

            cleanup();
            resolve({ exitCode, stdout, stderr, timedOut: false });
          } else {
            stdout += str;
          }
        };

        const onStderr = (data: Buffer) => {
          stderr += data.toString();
        };

        const cleanup = () => {
          clearTimeout(timer);
          session.process.stdout?.removeListener('data', onStdout);
          session.process.stderr?.removeListener('data', onStderr);
        };

        session.process.stdout?.on('data', onStdout);
        session.process.stderr?.on('data', onStderr);

        // Execute command and then echo the sentinel with exit code
        session.process.stdin?.write(`${command}\necho "${sentinel}EXIT:$?"\n`);
      });

      yield {
        type: 'action:bash:result',
        data: {
          success: result.exitCode === 0 && !result.timedOut,
          exitCode: result.exitCode,
          stdout: result.stdout.trim(),
          stderr: result.stderr.trim(),
          timedOut: result.timedOut,
          output: result.stderr.trim() ? result.stderr.trim() : result.stdout.trim(),
        },
        meta: event.meta,
      } as OpenBotEvent;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown bash error';
      yield {
        type: 'action:bash:result',
        data: {
          success: false,
          exitCode: -1,
          stdout: '',
          stderr: message,
          timedOut: false,
          error: message,
          output: message,
        },
        meta: event.meta,
      } as OpenBotEvent;
    }
  });

  // Add a tool to stop/kill the session
  builder.on('action:bash_stop', async function* (event, context) {
    const channelId = event.data?.channelId || context.state.channelId;
    const session = sessions.get(channelId);
    if (session) {
      session.process.kill();
      sessions.delete(channelId);
    }
    yield {
      type: 'action:bash_stop:result',
      data: { success: true, output: `Bash session for channel ${channelId} stopped.` },
      meta: event.meta,
    } as OpenBotEvent;
  });

  // Add a tool to list all active sessions
  builder.on('action:bash_list_sessions', async function* (event, context) {
    const activeSessions = Array.from(sessions.entries()).map(([channelId, session]) => ({
      channelId,
      cwd: session.cwd,
      lastActivity: session.lastActivity,
    }));

    yield {
      type: 'client:ui:widget',
      data: {
        widgetId: randomUUID(),
        kind: 'list',
        title: 'Active Bash Sessions',
        description: `Found ${activeSessions.length} active bash session${activeSessions.length === 1 ? '' : 's'}.`,
        items: activeSessions.map((s) => ({
          id: s.channelId,
          label: s.channelId,
          description: `CWD: ${s.cwd}`,
          status: 'done',
          metadata: {
            cwd: s.cwd,
            lastActivity: s.lastActivity,
          },
        })),
      },
      meta: event.meta,
    } as OpenBotEvent;

    yield {
      type: 'action:bash_list_sessions:result',
      data: {
        success: true,
        sessions: activeSessions,
        output: JSON.stringify(activeSessions),
      },
      meta: event.meta,
    } as OpenBotEvent;
  });
};

export const bashPlugin: Plugin = {
  id: 'bash',
  name: 'Bash',
  description: 'Stateful bash session for the channel.',
  toolDefinitions: bashToolDefinitions,
  factory: () => bashPluginRuntime(),
};

export default bashPlugin;
