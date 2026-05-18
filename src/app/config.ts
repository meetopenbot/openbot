import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface OpenBotconfig {
  name?: string;
  description?: string;
  model?: string;
  image?: string;
  baseDir?: string;
  port?: number;
  /**
   * Overrides the default public marketplace registry URL. If omitted or blank,
   * {@link DEFAULT_MARKETPLACE_REGISTRY_URL} is used.
   */
  marketplaceRegistryUrl?: string;
}

export interface StoredVariable {
  key: string;
  value: string;
  secret: boolean;
}

export const DEFAULT_BASE_DIR = '~/.openbot';
export const DEFAULT_PLUGINS_DIR = 'plugins';
export const DEFAULT_AGENTS_DIR = 'agents';
export const DEFAULT_CHANNELS_DIR = 'channels';
export const CONFIG_FILE = 'config.json';
export const VARIABLES_FILE = 'variables.json';

/** Public agent registry used when `marketplaceRegistryUrl` is not set. */
export const DEFAULT_MARKETPLACE_REGISTRY_URL =
  'https://raw.githubusercontent.com/meetopenbot/openbot-registry/main/registry.json';

export function resolvePath(p: string) {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : path.resolve(p);
}

export function loadConfig(): OpenBotconfig {
  const configPath = path.join(os.homedir(), '.openbot', CONFIG_FILE);
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (error) {
      console.error(`Warning: Failed to parse config at ${configPath}`, error);
    }
  }
  return {};
}

export function saveConfig(config: Partial<OpenBotconfig>) {
  const configDir = resolvePath(DEFAULT_BASE_DIR);
  const configPath = path.join(configDir, CONFIG_FILE);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  const currentConfig = loadConfig();
  const newConfig = { ...currentConfig, ...config };

  fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), { mode: 0o600 });
}

export function isConfigured(): boolean {
  const configPath = path.join(resolvePath(DEFAULT_BASE_DIR), CONFIG_FILE);
  return fs.existsSync(configPath);
}

export function loadVariables(): { version: number; variables: StoredVariable[] } {
  const config = loadConfig();
  const variablesPath = path.join(
    resolvePath(config.baseDir || DEFAULT_BASE_DIR),
    VARIABLES_FILE,
  );
  if (fs.existsSync(variablesPath)) {
    return JSON.parse(fs.readFileSync(variablesPath, 'utf-8')) as {
      version: number;
      variables: StoredVariable[];
    };
  }
  return { version: 1, variables: [] };
}

export const DEFAULT_AGENT_MD = `---
description: A specialized AI agent
---

# Agent Profile

You are a specialized AI agent within the OpenBot system.
Your role is defined by your configuration and the tools you have access to.

## Persona
- Helpful and precise
- Focused on my specific domain
- Professional in all interactions
`;

export const DEFAULT_USER_MD = `# About Me

<!-- OpenBot reads this file to understand who you are and how you like to work. -->
<!-- Edit it here or just chat — agents can update it with the "remember" tool. -->
`;
