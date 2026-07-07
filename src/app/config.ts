import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface OpenBotconfig {
  name?: string;
  description?: string;
  model?: string;
  image?: string;
  baseDir?: string;
  /** Parent directory for per-channel working directories (user-facing workspace). */
  channelsWorkspaceDir?: string;
  port?: number;
  /** Public base URL for workspace file links (e.g. https://my-host.example). Falls back to OPENBOT_PUBLIC_URL env or http://localhost:{port}. */
  publicUrl?: string;
}

export const DEFAULT_BASE_DIR = '~/.openbot';
/** Default parent directory for per-channel working directories (user-facing workspace). */
export const DEFAULT_CHANNELS_WORKSPACE_DIR = '~/openbot';
export const DEFAULT_PLUGINS_DIR = 'plugins';
export const DEFAULT_AGENTS_DIR = 'agents';
export const DEFAULT_CHANNELS_DIR = 'channels';
export const CONFIG_FILE = 'config.json';

export function resolvePath(p: string) {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : path.resolve(p);
}

function readConfigFile(configDir: string): OpenBotconfig {
  const configPath = path.join(configDir, CONFIG_FILE);
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as OpenBotconfig;
    } catch (error) {
      console.error(`Warning: Failed to parse config at ${configPath}`, error);
    }
  }
  return {};
}

/** Directory that holds `config.json` (env `OPENBOT_BASE_DIR` or `~/.openbot`). */
export function getConfigDir(): string {
  const envBase = process.env.OPENBOT_BASE_DIR?.trim();
  if (envBase) {
    return resolvePath(envBase);
  }
  return path.join(os.homedir(), '.openbot');
}

/** Resolved OpenBot data root (agents, channels, plugins). */
export function getBaseDir(): string {
  const envBase = process.env.OPENBOT_BASE_DIR?.trim();
  if (envBase) {
    return resolvePath(envBase);
  }
  const fileConfig = readConfigFile(getConfigDir());
  return resolvePath(fileConfig.baseDir || DEFAULT_BASE_DIR);
}

/** Resolved parent directory for per-channel workspace folders. */
export function getChannelsWorkspaceRoot(): string {
  const env = process.env.OPENBOT_CHANNELS_WORKSPACE_DIR?.trim();
  if (env) {
    return resolvePath(env);
  }
  const fileConfig = readConfigFile(getConfigDir());
  if (fileConfig.channelsWorkspaceDir) {
    return resolvePath(fileConfig.channelsWorkspaceDir);
  }
  return resolvePath(DEFAULT_CHANNELS_WORKSPACE_DIR);
}

/** Default absolute cwd for a channel when none is provided at creation time. */
export function getDefaultChannelCwd(channelId: string): string {
  const id = channelId.trim();
  if (!id) {
    throw new Error('channelId is required');
  }
  return path.join(getChannelsWorkspaceRoot(), id);
}

export function loadConfig(): OpenBotconfig {
  const fileConfig = readConfigFile(getConfigDir());
  const merged: OpenBotconfig = { ...fileConfig };

  merged.baseDir = getBaseDir();

  const envPublicUrl = process.env.OPENBOT_PUBLIC_URL?.trim();
  if (envPublicUrl) {
    merged.publicUrl = envPublicUrl.replace(/\/$/, '');
  } else if (merged.publicUrl) {
    merged.publicUrl = merged.publicUrl.replace(/\/$/, '');
  }

  merged.channelsWorkspaceDir = getChannelsWorkspaceRoot();

  const envPort = process.env.PORT?.trim();
  if (envPort && !Number.isNaN(Number(envPort))) {
    merged.port = Number(envPort);
  }

  return merged;
}

export function saveConfig(config: Partial<OpenBotconfig>) {
  const configDir = getConfigDir();
  const configPath = path.join(configDir, CONFIG_FILE);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  const currentConfig = readConfigFile(configDir);
  const newConfig = { ...currentConfig, ...config };

  fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), { mode: 0o600 });
}

export function isConfigured(): boolean {
  return fs.existsSync(path.join(getConfigDir(), CONFIG_FILE));
}
