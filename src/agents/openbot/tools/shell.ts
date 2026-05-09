import { MelonyPlugin } from 'melony';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { OpenBotEvent, OpenBotState } from '../../../app/types.js';

export const shellToolDefinitions = {
  shell_exec: {
    description:
      'Execute a shell command in the terminal. Use this for file operations, running scripts, or system tasks.',
    inputSchema: z.object({
      command: z.string().describe('The shell command to execute.'),
      cwd: z
        .string()
        .optional()
        .describe(
          'Working directory. Defaults to the channel cwd or workspace root. Leave empty unless the user requests a specific directory.',
        ),
      shell: z.enum(['bash', 'sh', 'zsh']).optional().describe('Shell to use. Defaults to bash.'),
      timeoutMs: z
        .number()
        .optional()
        .default(30000)
        .describe('Maximum execution time in milliseconds. Defaults to 30000 (30s).'),
    }),
  },
};

export const shellPlugin = (): MelonyPlugin<OpenBotState, OpenBotEvent> => (builder) => {
  builder.on('action:shell_exec', async function* (event, context) {
    const { command, cwd, shell = 'bash', timeoutMs = 30000 } = event.data;

    const actualTimeout = Math.max(1000, Math.min(timeoutMs, 60000));
    const actualCwd = cwd || context.state.channelDetails?.cwd || process.cwd();

    try {
      const result = await new Promise<{
        exitCode: number | null;
        stdout: string;
        stderr: string;
        timedOut: boolean;
      }>((resolve) => {
        const child = spawn(command, {
          shell,
          cwd: actualCwd,
          env: { ...process.env },
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill();
        }, actualTimeout);

        child.stdout.on('data', (data) => {
          stdout += data.toString();
          if (stdout.length > 100000) {
            stdout = stdout.substring(0, 100000) + '\n... [output truncated]';
            child.kill();
          }
        });

        child.stderr.on('data', (data) => {
          stderr += data.toString();
          if (stderr.length > 100000) {
            stderr = stderr.substring(0, 100000) + '\n... [output truncated]';
          }
        });

        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({ exitCode: code, stdout, stderr, timedOut });
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          resolve({ exitCode: -1, stdout, stderr: stderr + err.message, timedOut: false });
        });
      });

      const success = result.exitCode === 0 && !result.timedOut;

      yield {
        type: 'action:shell_exec:result',
        data: {
          success,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          timedOut: result.timedOut,
        },
        meta: event.meta,
      } as OpenBotEvent;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown shell error';
      yield {
        type: 'action:shell_exec:result',
        data: {
          success: false,
          exitCode: -1,
          stdout: '',
          stderr: message,
          timedOut: false,
          error: message,
        },
        meta: event.meta,
      } as OpenBotEvent;
    }
  });
};
