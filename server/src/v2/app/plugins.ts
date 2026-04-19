import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MelonyPlugin } from 'melony';
import { OpenBotEvent, OpenBotState } from './types.js';
import { aiSdkPlugin } from '../plugins/ai-sdk.js';
import { storagePlugin } from '../plugins/storage.js';
import { storageService } from '../services/storage.js';
import { DEFAULT_BASE_DIR, loadConfig, resolvePath } from './config.js';
import { threadsPlugin } from '../plugins/threads.js';

let pluginsDir: string | null = null;

/**
 * Initializes the plugins directory.
 */
export function initPlugins(dir?: string) {
  if (dir) {
    pluginsDir = dir;
  } else {
    const config = loadConfig();
    const baseDir = config.baseDir || DEFAULT_BASE_DIR;
    pluginsDir = path.join(resolvePath(baseDir), 'plugins');
  }
}

/**
 * Resolves a plugin from its name and config.
 */
export async function resolvePlugin(
  pluginName: string,
  config: any = {},
): Promise<MelonyPlugin<OpenBotState, OpenBotEvent> | null> {
  // 1. Built-in plugins
  switch (pluginName) {
    case 'storage':
      return storagePlugin({ storage: storageService, ...config });
    case 'ai-sdk':
      return aiSdkPlugin({
        ...config,
      });
    case 'threads':
      return threadsPlugin();
  }

  // 2. Search for external plugins in the initialized plugins directory
  if (!pluginsDir) {
    initPlugins();
  }

  if (pluginsDir) {
    const pluginDir = path.resolve(pluginsDir, pluginName);
    const distPath = path.join(pluginDir, 'dist', 'index.js');

    if (fs.existsSync(distPath)) {
      try {
        // Dynamic import needs file:// URL for absolute paths
        const module = await import(pathToFileURL(distPath).href);
        const factory = module.plugin.factory;

        if (typeof factory === 'function') {
          console.log(`[plugins] Loaded community plugin "${pluginName}" from ${distPath}`);
          return factory(config);
        }
      } catch (e) {
        console.warn(`[plugins] Failed to load plugin "${pluginName}" from ${distPath}:`, e);
      }
    }
  }

  console.warn(`[plugins] Plugin "${pluginName}" not found in v2 registry or external directory.`);
  return null;
}
