import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { PluginRegistryEntry } from "./plugin-registry.js";

/**
 * Get metadata (name, description, version) from a plugin directory.
 */
export async function getPluginMetadata(pluginDir: string): Promise<{ name: string; description: string; version: string }> {
  const pkgPath = path.join(pluginDir, "package.json");
  const hasPackageJson = await fs.access(pkgPath).then(() => true).catch(() => false);
  
  let name = path.basename(pluginDir);
  let description = "No description";
  let version = "0.0.0";

  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
      name = (pkg.name?.split("/").pop()) || name;
      description = pkg.description || description;
      version = pkg.version || version;
    } catch {
      // Fallback to defaults
    }
  }

  return { name, description, version };
}

/**
 * Ensure a plugin is ready to run by installing dependencies and building if necessary.
 */
export async function ensurePluginReady(pluginDir: string) {
  try {
    const pkgPath = path.join(pluginDir, "package.json");
    const hasPackageJson = await fs.access(pkgPath).then(() => true).catch(() => false);
    
    if (!hasPackageJson) return;

    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
    const nodeModulesPath = path.join(pluginDir, "node_modules");
    const hasNodeModules = await fs.access(nodeModulesPath).then(() => true).catch(() => false);

    // 1. Install dependencies if node_modules is missing
    if (!hasNodeModules) {
      console.log(`[plugins] Installing dependencies for ${path.basename(pluginDir)}...`);
      execSync("npm install", { cwd: pluginDir, stdio: "inherit" });
    }

    // 2. Run build if dist is missing but build script exists
    const distPath = path.join(pluginDir, "dist");
    const hasDist = await fs.access(distPath).then(() => true).catch(() => false);
    
    if (!hasDist && pkg.scripts?.build) {
      console.log(`[plugins] Building ${path.basename(pluginDir)}...`);
      execSync("npm run build", { cwd: pluginDir, stdio: "inherit" });
    }
  } catch (err) {
    console.error(`[plugins] Failed to prepare plugin in ${pluginDir}:`, err);
  }
}

/**
 * Dynamically load plugins from a directory.
 * Scans each subdirectory for an index.js (or index.ts if running via tsx).
 */
export async function loadPluginsFromDir(dir: string): Promise<PluginRegistryEntry[]> {
  const plugins: PluginRegistryEntry[] = [];

  try {
    await fs.access(dir);
  } catch {
    // Directory doesn't exist
    return plugins;
  }

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;

      const pluginDir = path.join(dir, entry.name);
      
      // Ensure plugin is ready (dependencies, build)
      await ensurePluginReady(pluginDir);

      // Try to find index.js or index.ts, prioritizing dist/index.js for pre-built bundles
      let indexPath: string | undefined;
      const possibleIndices = ["dist/index.js", "index.js", "index.ts"];
      
      for (const file of possibleIndices) {
        try {
          const fullPath = path.join(pluginDir, file);
          await fs.access(fullPath);
          indexPath = fullPath;
          break;
        } catch {
          continue;
        }
      }

      if (!indexPath) {
        console.warn(`[plugins] No index.js or index.ts found in ${pluginDir}`);
        continue;
      }

      try {
        // Use pathToFileURL for compatibility with import() on all OSs
        const moduleUrl = pathToFileURL(indexPath).href;
        const module = await import(moduleUrl);
        
        // The plugin can be exported as 'plugin', 'default', or 'entry'
        const entryData = module.plugin || module.default || module.entry;
        
        if (entryData && typeof entryData.factory === "function") {
          plugins.push({
            ...entryData,
            name: entryData.name || entry.name, // Fallback to folder name
          });
        } else {
          console.warn(`[plugins] "${entry.name}" does not export a valid plugin entry (missing factory)`);
        }
      } catch (err) {
        console.error(`[plugins] Failed to load plugin "${entry.name}":`, err);
      }
    }
  } catch (err) {
    console.warn(`[plugins] Error reading directory ${dir}:`, err);
  }

  return plugins;
}
