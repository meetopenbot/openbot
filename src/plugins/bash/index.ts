import { MelonyPlugin } from 'melony';
import { z } from 'zod';
import { spawn, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Plugin } from '../../services/plugins/types.js';
import { OpenBotEvent, OpenBotState } from '../../app/types.js';
import { resolvePath } from '../../app/config.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_LOG_CHARS = 32_000;

const bashToolDefinitions = {
  bash: {
    description:
      'Run a one-shot shell command and wait for it to finish. Use for installs, builds, git, file operations, and quick checks.',
    inputSchema: z.object({
      command: z.string().describe('The shell command to execute.'),
      cwd: z
        .string()
        .optional()
        .describe('Working directory. Defaults to the channel workspace.'),
      timeoutMs: z
        .number()
        .optional()
        .describe(`Max wait time in ms. Defaults to ${DEFAULT_TIMEOUT_MS}.`),
    }),
  },
  bash_start: {
    description:
      'Start a long-running background command (e.g. a dev server). Returns a job id immediately; use bash_list_jobs to read logs and bash_stop to end it.',
    inputSchema: z.object({
      command: z.string().describe('The shell command to start in the background.'),
      cwd: z
        .string()
        .optional()
        .describe('Working directory. Defaults to the channel workspace.'),
    }),
  },
  bash_stop: {
    description: 'Stop one background job by id, or all jobs for a channel.',
    inputSchema: z.object({
      jobId: z.string().optional().describe('Specific job id to stop.'),
      channelId: z
        .string()
        .optional()
        .describe('Stop all jobs for this channel. Defaults to the current channel.'),
    }),
  },
  bash_list_jobs: {
    description: 'List background jobs and recent log output.',
    inputSchema: z.object({
      channelId: z
        .string()
        .optional()
        .describe('Filter jobs to this channel. Defaults to the current channel.'),
    }),
  },
};

interface BashJob {
  id: string;
  channelId: string;
  command: string;
  cwd: string;
  process: ChildProcess;
  startedAt: number;
  status: 'running' | 'exited';
  exitCode: number | null;
  logs: string;
}

const jobs = new Map<string, BashJob>();

const resolveCwd = (context: { state: OpenBotState }, cwd?: string): string => {
  const raw =
    (typeof cwd === 'string' && cwd.trim()) ||
    context.state.channelDetails?.cwd ||
    process.cwd();
  return resolvePath(raw);
};

const appendLog = (job: BashJob, chunk: string) => {
  job.logs += chunk;
  if (job.logs.length > MAX_LOG_CHARS) {
    job.logs = job.logs.slice(-MAX_LOG_CHARS);
  }
};

const killJob = (job: BashJob) => {
  const { process: child } = job;
  if (!child.pid) {
    try {
      child.kill();
    } catch (_) { }
    return;
  }

  try {
    if (process.platform === 'win32') {
      child.kill();
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch (_) {
    try {
      child.kill();
    } catch (_) { }
  }
};

const removeJob = (jobId: string) => {
  jobs.delete(jobId);
};

const killJobsForChannel = (channelId: string): number => {
  let stopped = 0;
  for (const [jobId, job] of jobs.entries()) {
    if (job.channelId === channelId) {
      killJob(job);
      jobs.delete(jobId);
      stopped++;
    }
  }
  return stopped;
};

const runCommand = (
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> =>
  new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const finish = (result: {
      exitCode: number | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch (_) { }
      finish({ exitCode: null, stdout, stderr, timedOut });
    }, timeoutMs);

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      finish({
        exitCode: -1,
        stdout,
        stderr: err.message,
        timedOut: false,
      });
    });

    child.on('close', (code) => {
      finish({ exitCode: code, stdout, stderr, timedOut });
    });
  });

const startJob = (channelId: string, command: string, cwd: string): BashJob => {
  const child = spawn('bash', ['-lc', command], {
    cwd,
    env: process.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const job: BashJob = {
    id: randomUUID(),
    channelId,
    command,
    cwd,
    process: child,
    startedAt: Date.now(),
    status: 'running',
    exitCode: null,
    logs: '',
  };

  jobs.set(job.id, job);

  child.stdout?.on('data', (data: Buffer) => appendLog(job, data.toString()));
  child.stderr?.on('data', (data: Buffer) => appendLog(job, data.toString()));

  child.on('exit', (code) => {
    job.status = 'exited';
    job.exitCode = code;
  });

  child.on('error', (err) => {
    appendLog(job, `\n[error] ${err.message}\n`);
    job.status = 'exited';
    job.exitCode = -1;
  });

  return job;
};

const jobToSummary = (job: BashJob) => ({
  id: job.id,
  channelId: job.channelId,
  command: job.command,
  cwd: job.cwd,
  pid: job.process.pid ?? null,
  startedAt: job.startedAt,
  status: job.status,
  exitCode: job.exitCode,
  logTail: job.logs.slice(-4000),
});

const bashPluginRuntime = (): MelonyPlugin<OpenBotState, OpenBotEvent> => (builder) => {
  builder.on('action:bash', async function* (event, context) {
    const { command, cwd, timeoutMs } = event.data;
    const resolvedCwd = resolveCwd(context, cwd);

    try {
      const result = await runCommand(
        command,
        resolvedCwd,
        timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );

      const output = result.stderr.trim() || result.stdout.trim();

      yield {
        type: 'action:bash:result',
        data: {
          success: result.exitCode === 0 && !result.timedOut,
          exitCode: result.exitCode,
          stdout: result.stdout.trim(),
          stderr: result.stderr.trim(),
          timedOut: result.timedOut,
          output,
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

  builder.on('action:bash_start', async function* (event, context) {
    const { command, cwd } = event.data;
    const channelId = context.state.channelId;
    const resolvedCwd = resolveCwd(context, cwd);

    try {
      const job = startJob(channelId, command, resolvedCwd);

      yield {
        type: 'action:bash_start:result',
        data: {
          success: true,
          jobId: job.id,
          pid: job.process.pid ?? null,
          command: job.command,
          cwd: job.cwd,
          output: `Started job ${job.id}${job.process.pid ? ` (pid ${job.process.pid})` : ''}.`,
        },
        meta: event.meta,
      } as OpenBotEvent;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start job';
      yield {
        type: 'action:bash_start:result',
        data: {
          success: false,
          error: message,
          output: message,
        },
        meta: event.meta,
      } as OpenBotEvent;
    }
  });

  builder.on('action:bash_stop', async function* (event, context) {
    const { jobId, channelId } = event.data ?? {};
    const targetChannelId = channelId || context.state.channelId;

    if (jobId) {
      const job = jobs.get(jobId);
      if (job) {
        killJob(job);
        removeJob(jobId);
      }
      yield {
        type: 'action:bash_stop:result',
        data: {
          success: true,
          stopped: job ? 1 : 0,
          output: job ? `Stopped job ${jobId}.` : `Job ${jobId} was not found.`,
        },
        meta: event.meta,
      } as OpenBotEvent;
      return;
    }

    const stopped = killJobsForChannel(targetChannelId);

    yield {
      type: 'action:bash_stop:result',
      data: {
        success: true,
        stopped,
        output: `Stopped ${stopped} job${stopped === 1 ? '' : 's'} for channel ${targetChannelId}.`,
      },
      meta: event.meta,
    } as OpenBotEvent;
  });

  builder.on('action:bash_list_jobs', async function* (event, context) {
    const channelId = event.data?.channelId || context.state.channelId;
    const activeJobs = Array.from(jobs.values())
      .filter((job) => job.channelId === channelId)
      .map(jobToSummary);

    yield {
      type: 'client:ui:widget',
      data: {
        widgetId: randomUUID(),
        kind: 'list',
        title: 'Background Jobs',
        items: activeJobs.length > 0 ? activeJobs.map((job) => ({
          id: job.id,
          label: job.command,
          description: `${job.status} · pid ${job.pid ?? 'n/a'} · ${job.cwd}`,
          status: job.status === 'running' ? 'in_progress' : 'done',
          metadata: job,
        })) : [{ id: 'no-jobs', label: 'No jobs found' }],
      },
      meta: event.meta,
    } as OpenBotEvent;

    yield {
      type: 'action:bash_list_jobs:result',
      data: {
        success: true,
        jobs: activeJobs,
        output: JSON.stringify(activeJobs),
      },
      meta: event.meta,
    } as OpenBotEvent;
  });

  builder.on('action:delete_channel', async function* (event) {
    const channelId = (event.data as { channelId?: string })?.channelId;
    if (channelId) {
      killJobsForChannel(channelId);
    }
  });
};

export const bashPlugin: Plugin = {
  id: 'bash',
  name: 'Bash',
  description: 'One-shot commands and background jobs for the channel workspace.',
  toolDefinitions: bashToolDefinitions,
  factory: () => bashPluginRuntime(),
};

export default bashPlugin;
