import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from '../bus/plugin.js';
import { openbotPlugin } from '../plugins/openbot/index.js';
import { shellPlugin } from '../plugins/shell/index.js';
import { mcpPlugin } from '../plugins/mcp/index.js';
import { delegationPlugin } from '../plugins/delegation/index.js';
import { storageToolsPlugin } from '../plugins/storage-tools/index.js';
import { uiPlugin } from '../plugins/ui/index.js';
import { approvalPlugin } from '../plugins/approval/index.js';
import { memoryPlugin } from '../plugins/memory/index.js';
import { todoPlugin } from '../plugins/todo/index.js';
import { DEFAULT_PLUGINS_DIR, DEFAULT_BASE_DIR, loadConfig, resolvePath } from '../app/config.js';

let pluginsDir: string | null = null;
const loadedPlugins = new Set<string>();
const cache = new Map<string, Plugin>();

const BUILT_IN: Record<string, Plugin> = {
  [openbotPlugin.id]: openbotPlugin,
  [shellPlugin.id]: shellPlugin,
  [mcpPlugin.id]: mcpPlugin,
  [delegationPlugin.id]: delegationPlugin,
  [storageToolsPlugin.id]: storageToolsPlugin,
  [uiPlugin.id]: uiPlugin,
  [approvalPlugin.id]: approvalPlugin,
  [memoryPlugin.id]: memoryPlugin,
  [todoPlugin.id]: todoPlugin,
};

/**
 * Parsed shape of a community plugin module. The `id` is intentionally omitted:
 * the canonical id is the npm package name (== folder under `plugins/`),
 * assigned by the caller.
 */
export type ParsedPluginModule = Omit<Plugin, 'id'>;

/** Normalize a dynamically imported plugin module. Supports `plugin`, `default`. */
export function parsePluginModule(
  module: Record<string, unknown>,
): ParsedPluginModule | null {
  const raw =
    (module.plugin as Record<string, unknown> | undefined) ??
    (module.default as Record<string, unknown> | undefined);

  if (!raw || typeof raw !== 'object') return null;

  const factory = raw.factory;
  if (typeof factory !== 'function') return null;

  const name = typeof raw.name === 'string' ? raw.name : '';
  const description = typeof raw.description === 'string' ? raw.description : '';
  const image = typeof raw.image === 'string' ? raw.image : undefined;
  const configSchema = raw.configSchema as Plugin['configSchema'];
  const toolDefinitions = raw.toolDefinitions as Plugin['toolDefinitions'];

  return {
    name,
    description,
    image,
    configSchema,
    toolDefinitions,
    factory: factory as Plugin['factory'],
  };
}

/** Initialize the on-disk plugins directory (defaults to ~/.openbot/plugins). */
export function initPlugins(dir?: string) {
  if (dir) {
    pluginsDir = dir;
  } else {
    const config = loadConfig();
    const baseDir = config.baseDir || DEFAULT_BASE_DIR;
    pluginsDir = path.join(resolvePath(baseDir), DEFAULT_PLUGINS_DIR);
  }
}

/**
 * Resolve a Plugin by id. The id is either:
 *   - a built-in id (e.g. "openbot", "shell"), or
 *   - an npm package name (e.g. "openbot-plugin-foo" or "@scope/foo"),
 *     in which case the folder layout is `plugins/<id>/dist/index.js`.
 */
export async function resolvePlugin(id: string): Promise<Plugin | null> {
  if (cache.has(id)) return cache.get(id)!;
  if (BUILT_IN[id]) {
    cache.set(id, BUILT_IN[id]);
    return BUILT_IN[id];
  }

  if (!pluginsDir) {
    initPlugins();
  }
  if (!pluginsDir) return null;

  const distPath = path.join(pluginsDir, id, 'dist', 'index.js');

  if (!fs.existsSync(distPath)) {
    console.warn(`[plugins] Plugin "${id}" not found at ${distPath}.`);
    return null;
  }

  try {
    const module = await import(pathToFileURL(distPath).href);
    const parsed = parsePluginModule(module as Record<string, unknown>);
    if (!parsed) {
      console.warn(`[plugins] Plugin "${id}" at ${distPath} has no recognizable export.`);
      return null;
    }
    const plugin: Plugin = { id, ...parsed, name: parsed.name || id };
    cache.set(id, plugin);
    if (!loadedPlugins.has(id)) {
      console.log(`[plugins] Loaded community plugin "${id}" from ${distPath}`);
      loadedPlugins.add(id);
    }
    return plugin;
  } catch (e) {
    console.warn(`[plugins] Failed to load plugin "${id}" from ${distPath}:`, e);
    return null;
  }
}

/** Drop a single id from the in-memory cache (e.g. after fresh install). */
export function invalidatePlugin(id: string): void {
  cache.delete(id);
  loadedPlugins.delete(id);
}

/** List built-in plugins (for marketplace/registry views). */
export function listBuiltInPlugins(): Plugin[] {
  return Object.values(BUILT_IN);
}

export function getPluginsDir(): string | null {
  return pluginsDir;
}
