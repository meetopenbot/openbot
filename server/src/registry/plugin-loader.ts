import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { ToolPluginRegistryEntry } from './plugin-registry.js';
import { RuntimeRegistry } from './runtime-registry.js';
import { fileExists, findIndexFile, toTitleCaseFromSlug } from './loader-utils.js';

export async function getPluginMetadata(
  pluginDir: string,
): Promise<{ name: string; description: string; version: string }> {
  const pkgPath = path.join(pluginDir, 'package.json');
  const hasPackageJson = await fileExists(pkgPath);

  let name = 'Unnamed Plugin';
  let description = 'No description';
  let version = '0.0.0';

  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
      name = pkg.name?.split('/').pop() || name;
      description = pkg.description || description;
      version = pkg.version || version;
    } catch {
      /* fallback to defaults */
    }
  }

  return { name, description, version };
}

export async function ensurePluginReady(pluginDir: string) {
  try {
    const pkgPath = path.join(pluginDir, 'package.json');
    if (!(await fileExists(pkgPath))) return;

    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    const nodeModulesPath = path.join(pluginDir, 'node_modules');

    if (!(await fileExists(nodeModulesPath))) {
      console.log(`[plugins] Installing dependencies for ${path.basename(pluginDir)}...`);
      execSync('npm install', { cwd: pluginDir, stdio: 'inherit' });
    }

    const distPath = path.join(pluginDir, 'dist');
    if (!(await fileExists(distPath)) && pkg.scripts?.build) {
      console.log(`[plugins] Building ${path.basename(pluginDir)}...`);
      execSync('npm run build', { cwd: pluginDir, stdio: 'inherit' });
    }
  } catch (err) {
    console.error(`[plugins] Failed to prepare plugin in ${pluginDir}:`, err);
  }
}

export interface ListedToolPlugin {
  id: string;
  name: string;
  description: string;
  type: 'tool';
  folder: string;
}

export async function listToolPlugins(dir: string): Promise<ListedToolPlugin[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const listed: ListedToolPlugin[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) {
      continue;
    }

    const pluginDir = path.join(dir, entry.name);
    const hasIndex = !!(await findIndexFile(pluginDir));
    const hasPkg = await fileExists(path.join(pluginDir, 'package.json'));

    if (!hasIndex && !hasPkg) continue;
    const meta = await getPluginMetadata(pluginDir);

    listed.push({
      id: entry.name,
      name: meta.name || entry.name,
      description: meta.description || 'No description',
      type: 'tool',
      folder: pluginDir,
    });
  }

  return listed;
}

export async function discoverToolPlugins(
  pluginsDir: string,
  registry: RuntimeRegistry,
): Promise<void> {
  try {
    await fs.mkdir(pluginsDir, { recursive: true });
  } catch {
    /* best effort */
  }

  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(pluginsDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const folderName = entry.name;
    const pluginDir = path.join(pluginsDir, folderName);

    try {
      const hasAgentMd = await fileExists(path.join(pluginDir, 'AGENT.md'));
      if (hasAgentMd) {
        console.warn(`[plugins] Skipping "${folderName}" in plugins/: AGENT.md is not supported here.`);
        continue;
      }

      // ── Tool Plugin (TS/JS) ────────────────────────────────────────
      const indexPath = await findIndexFile(pluginDir);
      if (!indexPath) continue;

      await ensurePluginReady(pluginDir);
      const module = await import(pathToFileURL(indexPath).href + `?update=${Date.now()}`);
      const entryData = module.plugin || module.default || module.entry;

      if (entryData && typeof entryData.factory === 'function') {
        const meta = await getPluginMetadata(pluginDir);
        const id = folderName;
        let name = entryData.name || meta.name;
        if (!name || /^Unnamed\s+(Plugin|Tool|Agent)$/i.test(name)) {
          name = toTitleCaseFromSlug(folderName);
        }
        const pluginEntry: ToolPluginRegistryEntry = {
          id,
          name,
          description: entryData.description || meta.description || 'Tool plugin',
          plugin: entryData.factory,
          toolDefinitions: entryData.toolDefinitions || {},
          folder: pluginDir,
        };
        registry.registerTool(pluginEntry);
        console.log(`[plugins] Loaded tool: ${id} (${pluginEntry.name})`);
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.warn(`[plugins] Error loading "${folderName}":`, err);
      }
    }
  }
}
