import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_AGENT_PACKAGES_DIR,
  DEFAULT_BASE_DIR,
  loadConfig,
  resolvePath,
} from '../app/config.js';
import { parseAgentPackageModule } from '../registry/agents.js';

const execAsync = promisify(exec);

export interface InstallOptions {
  packageName: string;
  version?: string;
}

export interface InstalledPackage {
  name: string;
  id: string;
  version: string;
}

/**
 * Lifecycle for community-built agent packages distributed via npm.
 * The package format mirrors a normal npm package whose `dist/index.js`
 * exports `agentPackage` (or `default`) that satisfies the `AgentPackage`
 * interface.
 */
export const agentPackageService = {
  install: async ({ packageName, version }: InstallOptions): Promise<InstalledPackage> => {
    const config = loadConfig();
    const baseDir = resolvePath(config.baseDir || DEFAULT_BASE_DIR);
    const packagesDir = path.join(baseDir, DEFAULT_AGENT_PACKAGES_DIR);

    await fs.mkdir(packagesDir, { recursive: true });

    const target = version ? `${packageName}@${version}` : packageName;

    const entries = await fs.readdir(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const pkgPath = path.join(packagesDir, entry.name, 'package.json');
        if (existsSync(pkgPath)) {
          try {
            const pkgJson = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
            if (pkgJson.name === packageName && (!version || pkgJson.version === version)) {
              console.log(
                `[agent-packages] ${packageName}${version ? `@${version}` : ''} is already installed at ${entry.name}.`,
              );
              return {
                name: pkgJson.name,
                id: entry.name,
                version: pkgJson.version,
              };
            }
          } catch {
            // ignore corrupted package.json
          }
        }
      }
    }

    console.log(`[agent-packages] Installing ${target} to ${packagesDir}...`);

    try {
      const tempDir = path.join(packagesDir, '.tmp_' + Date.now());
      await fs.mkdir(tempDir, { recursive: true });

      await execAsync(`npm install ${target} --no-save --prefix "${tempDir}"`);

      const pkgNameOnly = packageName.includes('/') ? packageName.split('/').pop()! : packageName;
      const installedPath = path.join(tempDir, 'node_modules', packageName);

      let finalId = pkgNameOnly;
      try {
        const distPath = path.join(installedPath, 'dist', 'index.js');
        if (existsSync(distPath)) {
          const module = await import(pathToFileURL(distPath).href);
          const exported = parseAgentPackageModule(module as Record<string, unknown>);
          if (exported?.id) finalId = exported.id;
        }
      } catch (e) {
        console.warn(
          `[agent-packages] Could not read package metadata for ${packageName}; using folder name as id.`,
          e,
        );
      }

      const finalPath = path.join(packagesDir, finalId);

      await fs.rm(finalPath, { recursive: true, force: true });
      await fs.rename(installedPath, finalPath);
      await fs.rm(tempDir, { recursive: true, force: true });

      console.log(`[agent-packages] Running npm install in ${finalPath}...`);
      try {
        await execAsync(`npm install`, { cwd: finalPath });
        console.log(`[agent-packages] npm install completed in ${finalPath}`);
      } catch (e) {
        console.warn(`[agent-packages] Failed to run npm install in ${finalPath}:`, e);
      }

      const pkgJson = JSON.parse(await fs.readFile(path.join(finalPath, 'package.json'), 'utf-8'));

      return {
        name: pkgJson.name,
        id: finalId,
        version: pkgJson.version,
      };
    } catch (error) {
      console.error(`[agent-packages] Failed to install ${packageName}:`, error);
      throw new Error(
        `Failed to install agent package ${packageName}: ${(error as Error).message}`,
      );
    }
  },

  uninstall: async (id: string): Promise<void> => {
    const config = loadConfig();
    const baseDir = resolvePath(config.baseDir || DEFAULT_BASE_DIR);
    const packagesDir = path.join(baseDir, DEFAULT_AGENT_PACKAGES_DIR);
    const packagePath = path.join(packagesDir, id);

    try {
      await fs.rm(packagePath, { recursive: true, force: true });
      console.log(`[agent-packages] Uninstalled agent package ${id}`);
    } catch (error) {
      console.error(`[agent-packages] Failed to uninstall ${id}:`, error);
      throw new Error(
        `Failed to uninstall agent package ${id}: ${(error as Error).message}`,
      );
    }
  },
};
