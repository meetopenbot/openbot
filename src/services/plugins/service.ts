import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  DEFAULT_PLUGINS_DIR,
  DEFAULT_BASE_DIR,
  DEFAULT_MARKETPLACE_REGISTRY_URL,
  loadConfig,
  resolvePath,
} from '../../app/config.js';
import { invalidatePlugin } from './plugin-cache.js';
import { PluginRef } from './types.js';

const execAsync = promisify(exec);

export interface InstallOptions {
  packageName: string;
  version?: string;
}

export interface InstalledPlugin {
  /** npm package name; doubles as the plugin id used everywhere else. */
  name: string;
  version: string;
}

/** One marketplace entry; matches `action:marketplace:list:result` shape. */
export type MarketplaceAgentListing = {
  id: string;
  name: string;
  description: string;
  image?: string;
  instructions: string;
  plugins: PluginRef[];
};

export type StarterPrompt = {
  label: string;
  prompt: string;
};

/** One channel entry from the marketplace. */
export type MarketplaceChannelListing = {
  id: string;
  name: string;
  description: string;
  image?: string;
  spec?: string;
  initialState?: Record<string, unknown>;
  /** List of agent IDs that should be participants in the channel. */
  participants: string[];
  /** Starter prompts for the channel. */
  starterPrompts?: StarterPrompt[];
};

export interface MarketplaceRegistry {
  agents: MarketplaceAgentListing[];
  channels: MarketplaceChannelListing[];
}

const DEFAULT_MARKETPLACE_AGENTS: MarketplaceAgentListing[] = [];
const DEFAULT_MARKETPLACE_CHANNELS: MarketplaceChannelListing[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses JSON from a remote registry file. Supports either
 * `{ "agents": [ ... ], "channels": [ ... ] }` or a top-level array (legacy agents-only).
 */
export function parseMarketplaceRegistryJson(data: unknown): MarketplaceRegistry {
  const isLegacyArray = Array.isArray(data);
  const rawAgents: unknown = isLegacyArray
    ? data
    : isRecord(data) && Array.isArray(data.agents)
      ? data.agents
      : [];
  const rawChannels: unknown =
    !isLegacyArray && isRecord(data) && Array.isArray(data.channels)
      ? data.channels
      : isRecord(data) && Array.isArray((data as any).templates)
        ? (data as any).templates
        : [];

  const agents: MarketplaceAgentListing[] = (Array.isArray(rawAgents) ? rawAgents : []).map(
    (item, i) => {
      if (!isRecord(item)) {
        throw new Error(`agents[${i}]: expected object`);
      }
      const id = item.id;
      const name = item.name;
      const description = item.description;
      const instructions = item.instructions;
      const pluginsRaw = item.plugins;
      if (typeof id !== 'string' || !id)
        throw new Error(`agents[${i}].id must be a non-empty string`);
      if (typeof name !== 'string') throw new Error(`agents[${i}].name must be a string`);
      if (typeof description !== 'string')
        throw new Error(`agents[${i}].description must be a string`);
      if (typeof instructions !== 'string') {
        throw new Error(`agents[${i}].instructions must be a string`);
      }
      if (!Array.isArray(pluginsRaw)) throw new Error(`agents[${i}].plugins must be an array`);
      const plugins: PluginRef[] = pluginsRaw.map((p, j) => {
        if (!isRecord(p) || typeof p.id !== 'string' || !p.id) {
          throw new Error(`agents[${i}].plugins[${j}]: expected { "id": string, "config"?: object }`);
        }
        const ref: PluginRef = { id: p.id };
        if (p.config !== undefined) {
          if (!isRecord(p.config))
            throw new Error(`agents[${i}].plugins[${j}].config must be an object`);
          ref.config = p.config;
        }
        return ref;
      });
      const listing: MarketplaceAgentListing = { id, name, description, instructions, plugins };
      if (item.image !== undefined) {
        if (typeof item.image !== 'string') throw new Error(`agents[${i}].image must be a string`);
        listing.image = item.image;
      }
      return listing;
    },
  );

  const channels: MarketplaceChannelListing[] = (Array.isArray(rawChannels) ? rawChannels : []).map(
    (item, i) => {
      if (!isRecord(item)) {
        throw new Error(`channels[${i}]: expected object`);
      }
      const id = item.id;
      const name = item.name;
      const description = item.description;
      const participants = item.participants;

      if (typeof id !== 'string' || !id)
        throw new Error(`channels[${i}].id must be a non-empty string`);
      if (typeof name !== 'string') throw new Error(`channels[${i}].name must be a string`);
      if (typeof description !== 'string')
        throw new Error(`channels[${i}].description must be a string`);
      if (!Array.isArray(participants))
        throw new Error(`channels[${i}].participants must be an array`);

      const listing: MarketplaceChannelListing = {
        id,
        name,
        description,
        participants: participants.filter((p): p is string => typeof p === 'string'),
      };

      if (typeof item.image === 'string') listing.image = item.image;
      if (typeof item.spec === 'string') listing.spec = item.spec;
      if (isRecord(item.initialState)) listing.initialState = item.initialState;

      if (Array.isArray(item.starterPrompts)) {
        listing.starterPrompts = item.starterPrompts.map((p: any, j: number) => {
          if (!isRecord(p) || typeof p.label !== 'string' || typeof p.prompt !== 'string') {
            throw new Error(`channels[${i}].starterPrompts[${j}] must have label and prompt`);
          }
          return { label: p.label, prompt: p.prompt };
        });
      }

      return listing;
    },
  );

  return { agents, channels };
}

async function fetchMarketplaceRegistryFromUrl(url: string): Promise<MarketplaceRegistry> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Registry HTTP ${res.status} ${res.statusText}`);
  }
  const json: unknown = await res.json();
  return parseMarketplaceRegistryJson(json);
}

/**
 * Resolves marketplace registry (agents and channels) from configured registry URL.
 */
export async function resolveMarketplaceRegistry(): Promise<MarketplaceRegistry> {
  const { marketplaceRegistryUrl } = loadConfig();
  const registryUrl = marketplaceRegistryUrl?.trim() || DEFAULT_MARKETPLACE_REGISTRY_URL;
  try {
    return await fetchMarketplaceRegistryFromUrl(registryUrl);
  } catch (err) {
    console.warn(
      `[plugins] marketplace registry fetch failed (${registryUrl}), using built-in list:`,
      err instanceof Error ? err.message : err,
    );
    return { agents: DEFAULT_MARKETPLACE_AGENTS, channels: DEFAULT_MARKETPLACE_CHANNELS };
  }
}

/**
 * Resolves marketplace agent listings from configured registry URL.
 * @deprecated Use resolveMarketplaceRegistry instead.
 */
export async function resolveMarketplaceAgentList(): Promise<MarketplaceAgentListing[]> {
  const registry = await resolveMarketplaceRegistry();
  return registry.agents;
}

const getPluginsDir = (): string => {
  const config = loadConfig();
  const baseDir = resolvePath(config.baseDir || DEFAULT_BASE_DIR);
  return path.join(baseDir, DEFAULT_PLUGINS_DIR);
};

/**
 * Lifecycle for community-built plugins distributed via npm.
 * Each plugin is installed to `<plugins>/<npm-name>/` and is identified
 * everywhere (AGENT.md `plugins[].id`, registry, runtime resolution) by its
 * npm name. Scoped packages (`@scope/foo`) live under `<plugins>/@scope/foo/`.
 */
export const pluginService = {
  isInstalled: async (packageName: string): Promise<boolean> => {
    const finalPath = path.join(getPluginsDir(), packageName);
    return existsSync(path.join(finalPath, 'dist', 'index.js'));
  },

  install: async ({ packageName, version }: InstallOptions): Promise<InstalledPlugin> => {
    const pluginsDir = getPluginsDir();
    await fs.mkdir(pluginsDir, { recursive: true });

    const finalPath = path.join(pluginsDir, packageName);

    if (existsSync(path.join(finalPath, 'package.json'))) {
      try {
        const pkgJson = JSON.parse(
          await fs.readFile(path.join(finalPath, 'package.json'), 'utf-8'),
        );
        if (!version || pkgJson.version === version) {
          console.log(
            `[plugins] ${packageName}${version ? `@${version}` : ''} is already installed.`,
          );
          return { name: pkgJson.name, version: pkgJson.version };
        }
      } catch {
        // corrupted; reinstall below
      }
    }

    const target = version ? `${packageName}@${version}` : packageName;
    console.log(`[plugins] Installing ${target} to ${pluginsDir}...`);

    const tempDir = path.join(pluginsDir, '.tmp_' + Date.now());
    try {
      await fs.mkdir(tempDir, { recursive: true });
      await execAsync(`npm install ${target} --no-save --prefix "${tempDir}"`);

      const installedPath = path.join(tempDir, 'node_modules', packageName);
      if (!existsSync(installedPath)) {
        throw new Error(`npm did not produce ${installedPath}`);
      }

      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      await fs.rm(finalPath, { recursive: true, force: true });
      await fs.rename(installedPath, finalPath);

      console.log(`[plugins] Running npm install in ${finalPath}...`);
      try {
        await execAsync(`npm install`, { cwd: finalPath });
        console.log(`[plugins] npm install completed in ${finalPath}`);
      } catch (e) {
        console.warn(`[plugins] Failed to run npm install in ${finalPath}:`, e);
      }

      const pkgJson = JSON.parse(
        await fs.readFile(path.join(finalPath, 'package.json'), 'utf-8'),
      );

      invalidatePlugin(packageName);
      return { name: pkgJson.name, version: pkgJson.version };
    } catch (error) {
      console.error(`[plugins] Failed to install ${packageName}:`, error);
      throw new Error(
        `Failed to install plugin ${packageName}: ${(error as Error).message}`,
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  },

  uninstall: async (packageName: string): Promise<void> => {
    const pluginsDir = getPluginsDir();
    const pluginPath = path.join(pluginsDir, packageName);

    try {
      await fs.rm(pluginPath, { recursive: true, force: true });
      invalidatePlugin(packageName);
      console.log(`[plugins] Uninstalled plugin ${packageName}`);

      if (packageName.startsWith('@')) {
        const scopeDir = path.dirname(pluginPath);
        try {
          const remaining = await fs.readdir(scopeDir);
          if (remaining.length === 0) await fs.rmdir(scopeDir);
        } catch {
          // ignore
        }
      }
    } catch (error) {
      console.error(`[plugins] Failed to uninstall ${packageName}:`, error);
      throw new Error(
        `Failed to uninstall plugin ${packageName}: ${(error as Error).message}`,
      );
    }
  },
};

