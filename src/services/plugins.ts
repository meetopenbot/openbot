import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { DEFAULT_BASE_DIR, DEFAULT_PLUGINS_DIR, loadConfig, resolvePath } from '../app/config.js';

const execAsync = promisify(exec);

export interface PluginInstallOptions {
  packageName: string;
  version?: string;
}

export const pluginService = {
  /**
   * Installs a plugin from npm.
   * For simplicity, we use the npm CLI if available, or we could fetch the tarball.
   * Given the user's request for "straightforward", we'll use npm install --prefix.
   */
  installPlugin: async ({ packageName, version }: PluginInstallOptions): Promise<{ name: string; version: string }> => {
    const config = loadConfig();
    const baseDir = resolvePath(config.baseDir || DEFAULT_BASE_DIR);
    const pluginsDir = path.join(baseDir, DEFAULT_PLUGINS_DIR);

    await fs.mkdir(pluginsDir, { recursive: true });

    const target = version ? `${packageName}@${version}` : packageName;
    
    const pkgNameOnly = packageName.includes('/') ? packageName.split('/').pop()! : packageName;
    const finalPath = path.join(pluginsDir, pkgNameOnly);

    // Check if already installed
    if (existsSync(path.join(finalPath, 'package.json'))) {
      try {
        const pkgJson = JSON.parse(await fs.readFile(path.join(finalPath, 'package.json'), 'utf-8'));
        if (!version || pkgJson.version === version) {
          console.log(`[plugins] Plugin ${packageName}${version ? `@${version}` : ''} is already installed.`);
          return {
            name: pkgJson.name,
            version: pkgJson.version
          };
        }
      } catch (e) {
        // If package.json is corrupted, proceed with reinstall
      }
    }

    console.log(`[plugins] Installing ${target} to ${pluginsDir}...`);

    try {
      // We install it into a temporary location or directly into the plugins dir.
      // To match the current loader structure, we want: plugins/<package-name>/dist/index.js
      // npm install <pkg> --prefix <dir> creates <dir>/node_modules/<pkg>
      
      const tempDir = path.join(pluginsDir, '.tmp_' + Date.now());
      await fs.mkdir(tempDir, { recursive: true });

      await execAsync(`npm install ${target} --no-save --prefix "${tempDir}"`);

      // Move from node_modules/<pkg> to plugins/<pkg>
      const pkgNameOnly = packageName.includes('/') ? packageName.split('/').pop()! : packageName;
      const installedPath = path.join(tempDir, 'node_modules', packageName);
      const finalPath = path.join(pluginsDir, pkgNameOnly);

      // Remove existing if any
      await fs.rm(finalPath, { recursive: true, force: true });
      await fs.rename(installedPath, finalPath);

      // Cleanup temp
      await fs.rm(tempDir, { recursive: true, force: true });

      // Read package.json for confirmation
      const pkgJson = JSON.parse(await fs.readFile(path.join(finalPath, 'package.json'), 'utf-8'));
      
      return {
        name: pkgJson.name,
        version: pkgJson.version
      };
    } catch (error) {
      console.error(`[plugins] Failed to install plugin ${packageName}:`, error);
      throw new Error(`Failed to install plugin ${packageName}: ${(error as Error).message}`);
    }
  },

  /**
   * Uninstalls a plugin by removing its directory.
   */
  uninstallPlugin: async (pluginName: string): Promise<void> => {
    const config = loadConfig();
    const baseDir = resolvePath(config.baseDir || DEFAULT_BASE_DIR);
    const pluginsDir = path.join(baseDir, DEFAULT_PLUGINS_DIR);
    const pluginPath = path.join(pluginsDir, pluginName);

    try {
      await fs.rm(pluginPath, { recursive: true, force: true });
      console.log(`[plugins] Uninstalled plugin ${pluginName}`);
    } catch (error) {
      console.error(`[plugins] Failed to uninstall plugin ${pluginName}:`, error);
      throw new Error(`Failed to uninstall plugin ${pluginName}: ${(error as Error).message}`);
    }
  }
};
