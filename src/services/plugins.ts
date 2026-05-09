import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  DEFAULT_PLUGINS_DIR,
  DEFAULT_BASE_DIR,
  loadConfig,
  resolvePath,
} from '../app/config.js';
import { invalidatePlugin } from '../registry/plugins.js';

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
