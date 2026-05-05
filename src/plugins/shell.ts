import { MelonyPlugin } from 'melony';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { OpenBotEvent, OpenBotState } from '../app/types.js';

export const shellToolDefinitions = {
  shell_exec: {
    description: 'Execute a shell command in the terminal. Use this for file operations, running scripts, or system tasks.',
    inputSchema: z.object({
      command: z.string().describe('The shell command to execute.'),
      cwd: z.string().optional().describe('The working directory for the command. Defaults to the channel cwd or workspace root. Leave it empty unless user asks for a specific directory.'),
      shell: z.enum(['bash', 'sh', 'zsh']).optional().describe('The shell to use. Defaults to bash.'),
      timeoutMs: z.number().optional().default(30000).describe('Maximum execution time in milliseconds. Defaults to 30000 (30s).'),
    }),
  },
};

export const shellPlugin = (): MelonyPlugin<OpenBotState, OpenBotEvent> => (builder) => {
  builder.on('action:shell_exec', async function* (event, context) {
    const { command, cwd, shell = 'bash', timeoutMs = 30000 } = event.data;

    // Clamp timeout between 1s and 60s
    const actualTimeout = Math.max(1000, Math.min(timeoutMs, 60000));
    
    // Default CWD to channel CWD if not provided
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
          // Cap output at 100KB
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
      } as any;

      const output = [
        `Command: \`${command}\``,
        result.exitCode !== null ? `Exit code: ${result.exitCode}` : 'Exit code: unknown',
        result.timedOut ? '⚠️ Command timed out.' : '',
        result.stdout ? `\n**STDOUT**:\n${result.stdout}` : '',
        result.stderr ? `\n**STDERR**:\n${result.stderr}` : '',
      ].filter(Boolean).join('\n');

      yield {
        type: 'agent:output',
        data: {
          content: output,
        },
        meta: {
          ...(event.meta || {}),
          agentId: context.state.agentId,
        },
      } as any;

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
      } as any;

      yield {
        type: 'agent:output',
        data: {
          content: `Failed to execute shell command: ${message}`,
        },
        meta: {
          ...(event.meta || {}),
          agentId: context.state.agentId,
        },
      } as any;
    }
  });
};

export const plugin = {
  name: 'shell',
  description: 'Execute shell commands in the terminal',
  version: '1.0.0',
  author: 'OpenBot',
  license: 'MIT',
  factory: shellPlugin,
  toolDefinitions: shellToolDefinitions,
};
