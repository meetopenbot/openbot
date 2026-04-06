import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolvePath, DEFAULT_BASE_DIR, loadConfig } from "../app/config.js";
import { ensurePluginReady } from "../registry/plugin-loader.js";
import { readAgentConfig } from "../registry/agent-loader.js";

export type InstallSource =
  | { type: "github"; value: string }
  | { type: "npm"; value: string }
  | { type: "local"; value: string };

export type PluginInstallSource = InstallSource;

interface InstallOptions {
  quiet?: boolean;
  id?: string;
}

const BUILT_IN_PLUGIN_NAMES = new Set(["shell", "file-system", "approval"]);

function run(command: string, args: string[], options?: { cwd?: string; quiet?: boolean }) {
  execFileSync(command, args, {
    cwd: options?.cwd,
    stdio: options?.quiet ? "ignore" : "inherit",
  });
}

function log(message: string, quiet?: boolean) {
  if (!quiet) console.log(message);
}

function getBaseDir() {
  const cfg = loadConfig();
  const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
  return resolvePath(baseDir);
}

async function directoryExists(targetPath: string) {
  return fs.access(targetPath).then(() => true).catch(() => false);
}

export function checkGitHubRepo(repo: string): boolean {
  try {
    const url = `https://github.com/${repo}.git`;
    run("git", ["ls-remote", url], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

export function checkNpmPackage(pkg: string): boolean {
  try {
    run("npm", ["show", pkg, "version"], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

export function parseSource(source: string): InstallSource {
  const normalized = source.trim();
  const isGithub = (normalized.includes("/") || normalized.startsWith("github:"))
    && !normalized.startsWith("/")
    && !normalized.startsWith(".");
  const isNpm = normalized.startsWith("@") || normalized.startsWith("npm:");

  if (isGithub) {
    return {
      type: "github",
      value: normalized.startsWith("github:") ? normalized.slice(7) : normalized,
    };
  }
  if (isNpm) {
    return {
      type: "npm",
      value: normalized.startsWith("npm:") ? normalized.slice(4) : normalized,
    };
  }
  return { type: "local", value: path.resolve(normalized) };
}

export async function installPluginFromSource(
  source: InstallSource,
  options: InstallOptions = {},
) {
  const quiet = !!options.quiet;
  const baseDir = getBaseDir();
  const targetRoot = path.join(baseDir, "plugins");
  await fs.mkdir(targetRoot, { recursive: true });

  // 1. Determine the folder name (the "id") - ALWAYS based on source or explicit id
  let id = options.id;
  if (!id) {
    if (source.type === "github") {
      id = path.basename(source.value); // e.g. "agent-browser"
    } else if (source.type === "npm") {
      id = source.value.split("/").pop(); // e.g. "@melony/plugin-test" -> "plugin-test"
    } else {
      id = path.basename(source.value);
    }
  }

  const targetDir = path.join(targetRoot, id!);
  const tempDir = path.join(tmpdir(), `openbot-install-${Date.now()}-${id}`);

  try {
    log(`📦 Installing plugin "${id}" from ${source.type}...`, quiet);

    if (source.type === "github") {
      const url = `https://github.com/${source.value}.git`;
      run("git", ["clone", "--depth", "1", url, tempDir], { quiet });
    } else if (source.type === "npm") {
      await fs.mkdir(tempDir, { recursive: true });
      run("npm", ["install", source.value, "--prefix", tempDir], { quiet });
      const pkgFolder = path.join(tempDir, "node_modules", source.value);
      const moveTemp = path.join(tmpdir(), `openbot-npm-move-${Date.now()}`);
      await fs.rename(pkgFolder, moveTemp);
      await fs.rm(tempDir, { recursive: true, force: true });
      await fs.rename(moveTemp, tempDir);
    } else {
      await fs.mkdir(tempDir, { recursive: true });
      await fs.cp(source.value, tempDir, { recursive: true });
    }

    if (await directoryExists(targetDir)) {
      log(`⚠️  Removing existing folder: ${targetDir}`, quiet);
      await fs.rm(targetDir, { recursive: true, force: true });
    }

    await fs.rename(tempDir, targetDir);
    log(`✅ Installed to: ${targetDir}`, quiet);

    // Prepare dependencies and build
    await ensurePluginReady(targetDir);
    log(`🎉 Successfully installed plugin: ${id}`, quiet);
    return id;
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export const parsePluginInstallSource = parseSource;

export async function installMissingPluginsFromAgent(
  agentFolder: string,
  options: InstallOptions = {},
) {
  const quiet = !!options.quiet;
  const config = await readAgentConfig(agentFolder);
  const baseDir = getBaseDir();

  for (const pluginItem of config.plugins || []) {
    const pluginName = typeof pluginItem === "string" ? pluginItem : pluginItem.name;
    if (!pluginName || BUILT_IN_PLUGIN_NAMES.has(pluginName)) continue;

    // Check if it already exists as a folder in plugins/
    const pluginPath = path.join(baseDir, "plugins", pluginName);
    const prefixedPluginPath = path.join(baseDir, "plugins", `plugin-${pluginName}`);
    
    if (await (directoryExists(pluginPath)) || await (directoryExists(prefixedPluginPath))) {
      continue;
    }

    log(`🔍 Agent needs plugin "${pluginName}". Searching...`, quiet);

    const ghRepo = `meetopenbot/plugin-${pluginName}`;
    if (checkGitHubRepo(ghRepo)) {
      await installPluginFromSource({ type: "github", value: ghRepo }, { quiet });
      continue;
    }

    const npmPkg = `@melony/plugin-${pluginName}`;
    if (checkNpmPackage(npmPkg)) {
      await installPluginFromSource({ type: "npm", value: npmPkg }, { quiet });
      continue;
    }

    log(`⚠️  Could not find plugin "${pluginName}" for this agent.`, quiet);
  }
}
