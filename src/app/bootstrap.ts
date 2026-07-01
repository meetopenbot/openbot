import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CONFIG_FILE,
  DEFAULT_AGENTS_DIR,
  DEFAULT_CHANNELS_DIR,
  DEFAULT_PLUGINS_DIR,
  getBaseDir,
  getChannelsWorkspaceRoot,
  getConfigDir,
  type OpenBotconfig,
} from './config.js';

/** Ensure data directories and a minimal config exist (first boot on a Fly volume). */
export async function bootstrap(): Promise<void> {
  const baseDir = getBaseDir();
  const configDir = getConfigDir();

  await fs.mkdir(path.join(baseDir, DEFAULT_AGENTS_DIR), { recursive: true });
  await fs.mkdir(path.join(baseDir, DEFAULT_PLUGINS_DIR), { recursive: true });
  await fs.mkdir(path.join(baseDir, DEFAULT_CHANNELS_DIR), { recursive: true });
  await fs.mkdir(getChannelsWorkspaceRoot(), { recursive: true });
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });

  const configPath = path.join(configDir, CONFIG_FILE);
  try {
    await fs.access(configPath);
  } catch {
    const initial: OpenBotconfig = { baseDir };

    const publicUrl = process.env.OPENBOT_PUBLIC_URL?.trim();
    if (publicUrl) {
      initial.publicUrl = publicUrl.replace(/\/$/, '');
    }

    const workspaceDir = process.env.OPENBOT_CHANNELS_WORKSPACE_DIR?.trim();
    if (workspaceDir) {
      initial.channelsWorkspaceDir = getChannelsWorkspaceRoot();
    }

    await fs.writeFile(configPath, JSON.stringify(initial, null, 2), { mode: 0o600 });
  }
}
