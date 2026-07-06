import { MelonyPlugin } from 'melony';
import { z } from 'zod';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Plugin } from '../../services/plugins/types.js';
import type { Storage } from '../../services/plugins/domain.js';
import { OpenBotEvent, OpenBotState } from '../../app/types.js';

const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const TUNNEL_READY_TIMEOUT_MS = 60_000;
const MAX_LOG_CHARS = 8_000;

const previewToolDefinitions = {
  expose_port: {
    description:
      'Expose a local dev server port via a temporary public Cloudflare quick tunnel. Returns a previewUrl stored on the channel. Dev servers must listen on 0.0.0.0 or 127.0.0.1. Call after shell_exec when the server is ready.',
    inputSchema: z.object({
      port: z
        .number()
        .int()
        .min(1024)
        .max(65535)
        .describe('Local port of the running dev server (e.g. 5173).'),
    }),
  },
  unexpose_port: {
    description:
      'Stop the active Cloudflare preview tunnel for this channel and clear previewUrl from channel state.',
    inputSchema: z.object({}),
  },
};

interface PreviewTunnel {
  id: string;
  channelId: string;
  port: number;
  url: string;
  process: ChildProcess;
  startedAt: number;
  logs: string;
}

const tunnels = new Map<string, PreviewTunnel>();
const tunnelByChannel = new Map<string, string>();

const blockedPorts = (): Set<number> => {
  const openbotPort = Number(process.env.PORT ?? 4132);
  return new Set([22, 80, 443, openbotPort]);
};

const appendLog = (tunnel: PreviewTunnel, chunk: string) => {
  tunnel.logs += chunk;
  if (tunnel.logs.length > MAX_LOG_CHARS) {
    tunnel.logs = tunnel.logs.slice(-MAX_LOG_CHARS);
  }
};

const killTunnelProcess = (tunnel: PreviewTunnel) => {
  const { process: child } = tunnel;
  if (!child.pid) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    return;
  }

  try {
    child.kill('SIGTERM');
  } catch {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
};

const removeTunnel = (tunnelId: string) => {
  const tunnel = tunnels.get(tunnelId);
  if (!tunnel) return;
  killTunnelProcess(tunnel);
  tunnels.delete(tunnelId);
  if (tunnelByChannel.get(tunnel.channelId) === tunnelId) {
    tunnelByChannel.delete(tunnel.channelId);
  }
};

export const stopPreviewForChannel = (channelId: string) => {
  const tunnelId = tunnelByChannel.get(channelId);
  if (tunnelId) {
    removeTunnel(tunnelId);
  }
};

const waitForTunnelUrl = (child: ChildProcess, timeoutMs: number): Promise<string> =>
  new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
    };

    const tryParse = () => {
      const match = buffer.match(TUNNEL_URL_PATTERN);
      if (match) {
        settled = true;
        cleanup();
        resolve(match[0]);
      }
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      if (buffer.length > 16_000) {
        buffer = buffer.slice(-16_000);
      }
      tryParse();
    };

    const onExit = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`cloudflared exited before providing a tunnel URL (code ${code ?? 'unknown'})`));
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Timed out waiting for Cloudflare tunnel URL'));
    }, timeoutMs);

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', onExit);
    child.on('error', onError);
    tryParse();
  });

const startCloudflaredTunnel = async (channelId: string, port: number): Promise<PreviewTunnel> => {
  const child = spawn(
    'cloudflared',
    ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'],
    {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const tunnel: PreviewTunnel = {
    id: randomUUID(),
    channelId,
    port,
    url: '',
    process: child,
    startedAt: Date.now(),
    logs: '',
  };

  child.stdout?.on('data', (data: Buffer) => appendLog(tunnel, data.toString()));
  child.stderr?.on('data', (data: Buffer) => appendLog(tunnel, data.toString()));

  child.on('exit', () => {
    tunnels.delete(tunnel.id);
    if (tunnelByChannel.get(channelId) === tunnel.id) {
      tunnelByChannel.delete(channelId);
    }
  });

  const url = await waitForTunnelUrl(child, TUNNEL_READY_TIMEOUT_MS);
  tunnel.url = url;
  tunnels.set(tunnel.id, tunnel);
  tunnelByChannel.set(channelId, tunnel.id);
  return tunnel;
};

const clearPreviewChannelState = async (storage: Storage, channelId: string) => {
  await storage.patchChannelState({
    channelId,
    state: {
      previewUrl: null,
      previewPort: null,
      previewExposedAt: null,
    },
  });
};

const previewPluginRuntime =
  (storage: Storage): MelonyPlugin<OpenBotState, OpenBotEvent> =>
  (builder) => {
    builder.on('action:expose_port', async function* (event, context) {
      const channelId = context.state.channelId;
      const port = event.data?.port;

      if (!Number.isInteger(port)) {
        yield {
          type: 'action:expose_port:result',
          data: {
            success: false,
            output: 'port must be an integer between 1024 and 65535.',
          },
          meta: event.meta,
        } as OpenBotEvent;
        return;
      }

      if (blockedPorts().has(port)) {
        yield {
          type: 'action:expose_port:result',
          data: {
            success: false,
            output: `Port ${port} is reserved and cannot be exposed.`,
          },
          meta: event.meta,
        } as OpenBotEvent;
        return;
      }

      const existingTunnelId = tunnelByChannel.get(channelId);
      if (existingTunnelId) {
        removeTunnel(existingTunnelId);
      }

      try {
        const tunnel = await startCloudflaredTunnel(channelId, port);

        await storage.patchChannelState({
          channelId,
          state: {
            previewUrl: tunnel.url,
            previewPort: port,
            previewExposedAt: tunnel.startedAt,
          },
        });

        if (context.state.channelDetails) {
          context.state.channelDetails = await storage.getChannelDetails({ channelId });
        }

        yield {
          type: 'action:expose_port:result',
          data: {
            success: true,
            previewUrl: tunnel.url,
            port,
            temporary: true,
            output: `Preview available at ${tunnel.url} (temporary Cloudflare quick tunnel).`,
          },
          meta: event.meta,
        } as OpenBotEvent;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to start Cloudflare tunnel';
        const needsCloudflared =
          message.includes('ENOENT') || message.toLowerCase().includes('cloudflared');
        const hint = needsCloudflared
          ? ' Install cloudflared and ensure it is on PATH (https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/downloads/).'
          : '';

        yield {
          type: 'action:expose_port:result',
          data: {
            success: false,
            error: message,
            output: `${message}${hint}`,
          },
          meta: event.meta,
        } as OpenBotEvent;
      }
    });

    builder.on('action:unexpose_port', async function* (event, context) {
      const channelId = context.state.channelId;

      stopPreviewForChannel(channelId);
      await clearPreviewChannelState(storage, channelId);

      if (context.state.channelDetails) {
        context.state.channelDetails = await storage.getChannelDetails({ channelId });
      }

      yield {
        type: 'action:unexpose_port:result',
        data: {
          success: true,
          output: 'Preview tunnel stopped and previewUrl cleared from channel state.',
        },
        meta: event.meta,
      } as OpenBotEvent;
    });

    builder.on('action:delete_channel', async function* (event) {
      const channelId = (event.data as { channelId?: string })?.channelId;
      if (channelId) {
        stopPreviewForChannel(channelId);
      }
    });
  };

export const previewPlugin: Plugin = {
  id: 'preview',
  name: 'Preview',
  description: 'Temporary public preview URLs via Cloudflare quick tunnels.',
  toolDefinitions: previewToolDefinitions,
  factory: ({ storage }) => previewPluginRuntime(storage),
};

export default previewPlugin;
