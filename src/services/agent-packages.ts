import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  DEFAULT_AGENT_PACKAGES_DIR,
  DEFAULT_BASE_DIR,
  loadConfig,
  resolvePath,
} from '../app/config.js';
import { invalidateAgentPackage } from '../registry/agents.js';

const execAsync = promisify(exec);

export interface InstallOptions {
  packageName: string;
  version?: string;
}

export interface InstalledPackage {
  /** npm package name; doubles as the `packageId` used everywhere else. */
  name: string;
  version: string;
}

const getPackagesDir = (): string => {
  const config = loadConfig();
  const baseDir = resolvePath(config.baseDir || DEFAULT_BASE_DIR);
  return path.join(baseDir, DEFAULT_AGENT_PACKAGES_DIR);
};

/**
 * Lifecycle for community-built agent packages distributed via npm.
 * Each package is installed to `<agent-packages>/<npm-name>/` and is identified
 * everywhere (AGENT.md `packageId`, registry, runtime resolution) by its npm name.
 * Scoped packages (`@scope/foo`) live under `<agent-packages>/@scope/foo/`.
 */
export const agentPackageService = {
  isInstalled: async (packageName: string): Promise<boolean> => {
    const finalPath = path.join(getPackagesDir(), packageName);
    return existsSync(path.join(finalPath, 'dist', 'index.js'));
  },

  install: async ({ packageName, version }: InstallOptions): Promise<InstalledPackage> => {
    const packagesDir = getPackagesDir();
    await fs.mkdir(packagesDir, { recursive: true });

    const finalPath = path.join(packagesDir, packageName);

    if (existsSync(path.join(finalPath, 'package.json'))) {
      try {
        const pkgJson = JSON.parse(
          await fs.readFile(path.join(finalPath, 'package.json'), 'utf-8'),
        );
        if (!version || pkgJson.version === version) {
          console.log(
            `[agent-packages] ${packageName}${version ? `@${version}` : ''} is already installed.`,
          );
          return { name: pkgJson.name, version: pkgJson.version };
        }
      } catch {
        // corrupted; reinstall below
      }
    }

    const target = version ? `${packageName}@${version}` : packageName;
    console.log(`[agent-packages] Installing ${target} to ${packagesDir}...`);

    const tempDir = path.join(packagesDir, '.tmp_' + Date.now());
    try {
      await fs.mkdir(tempDir, { recursive: true });
      await execAsync(`npm install ${target} --no-save --prefix "${tempDir}"`);

      const installedPath = path.join(tempDir, 'node_modules', packageName);
      if (!existsSync(installedPath)) {
        throw new Error(`npm did not produce ${installedPath}`);
      }

      // Ensure parent dir exists for scoped packages (e.g. @scope/foo).
      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      await fs.rm(finalPath, { recursive: true, force: true });
      await fs.rename(installedPath, finalPath);

      console.log(`[agent-packages] Running npm install in ${finalPath}...`);
      try {
        await execAsync(`npm install`, { cwd: finalPath });
        console.log(`[agent-packages] npm install completed in ${finalPath}`);
      } catch (e) {
        console.warn(`[agent-packages] Failed to run npm install in ${finalPath}:`, e);
      }

      const pkgJson = JSON.parse(
        await fs.readFile(path.join(finalPath, 'package.json'), 'utf-8'),
      );

      invalidateAgentPackage(packageName);
      return { name: pkgJson.name, version: pkgJson.version };
    } catch (error) {
      console.error(`[agent-packages] Failed to install ${packageName}:`, error);
      throw new Error(
        `Failed to install agent package ${packageName}: ${(error as Error).message}`,
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  },

  uninstall: async (packageName: string): Promise<void> => {
    const packagesDir = getPackagesDir();
    const packagePath = path.join(packagesDir, packageName);

    try {
      await fs.rm(packagePath, { recursive: true, force: true });
      invalidateAgentPackage(packageName);
      console.log(`[agent-packages] Uninstalled agent package ${packageName}`);

      // Best-effort cleanup of empty @scope/ parent.
      if (packageName.startsWith('@')) {
        const scopeDir = path.dirname(packagePath);
        try {
          const remaining = await fs.readdir(scopeDir);
          if (remaining.length === 0) await fs.rmdir(scopeDir);
        } catch {
          // ignore
        }
      }
    } catch (error) {
      console.error(`[agent-packages] Failed to uninstall ${packageName}:`, error);
      throw new Error(
        `Failed to uninstall agent package ${packageName}: ${(error as Error).message}`,
      );
    }
  },
};
