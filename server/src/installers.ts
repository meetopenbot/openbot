import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolvePath, DEFAULT_BASE_DIR, loadConfig } from "./config.js";
import { getPluginMetadata, readAgentConfig, ensurePluginReady } from "./registry/plugin-loader.js";

export type PluginInstallSource =
  | { type: "github"; value: string }
  | { type: "npm"; value: string }
  | { type: "local"; value: string };

export type AgentInstallSource = { type: "github"; value: string };

interface InstallOptions {
  quiet?: boolean;
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

function githubRepoToCloneUrl(repo: string) {
  return `https://github.com/${repo}.git`;
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
    run("git", ["ls-remote", githubRepoToCloneUrl(repo)], { quiet: true });
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

export function parsePluginInstallSource(source: string): PluginInstallSource {
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

export function parseAgentInstallSource(source: string): AgentInstallSource {
  const normalized = source.trim();
  if (normalized.startsWith("github:")) {
    return { type: "github", value: normalized.slice(7) };
  }
  return { type: "github", value: normalized };
}

export async function installPluginFromSource(source: PluginInstallSource, options: InstallOptions = {}) {
  const quiet = !!options.quiet;
  const tempDir = path.join(tmpdir(), `openbot-plugin-install-${Date.now()}`);
  const baseDir = getBaseDir();
  const pluginRoot = path.join(baseDir, "plugins");
  await fs.mkdir(pluginRoot, { recursive: true });

  try {
    if (source.type === "github") {
      log(`📦 Installing plugin from: ${githubRepoToCloneUrl(source.value)}`, quiet);
      run("git", ["clone", "--depth", "1", githubRepoToCloneUrl(source.value), tempDir], { quiet });
    } else if (source.type === "npm") {
      log(`📦 Installing plugin from: ${source.value}`, quiet);
      await fs.mkdir(tempDir, { recursive: true });
      run("npm", ["install", source.value, "--prefix", tempDir], { quiet });
      const pkgFolder = path.join(tempDir, "node_modules", source.value);
      const moveTemp = path.join(tmpdir(), `openbot-npm-move-${Date.now()}`);
      await fs.rename(pkgFolder, moveTemp);
      await fs.rm(tempDir, { recursive: true, force: true });
      await fs.rename(moveTemp, tempDir);
    } else {
      log(`📦 Installing plugin from: ${source.value}`, quiet);
      await fs.mkdir(tempDir, { recursive: true });
      await fs.cp(source.value, tempDir, { recursive: true });
    }

    const { name } = await getPluginMetadata(tempDir);
    const targetDir = path.join(pluginRoot, name);
    if (await directoryExists(targetDir)) {
      log(`⚠️  Plugin "${name}" already exists. Overwriting...`, quiet);
      await fs.rm(targetDir, { recursive: true, force: true });
    }

    await fs.rename(tempDir, targetDir);
    log(`✅ Moved to: ${targetDir}`, quiet);
    log(`⚙️  Preparing plugin "${name}"...`, quiet);
    await ensurePluginReady(targetDir);
    log(`\n🎉 Successfully installed plugin: ${name}`, quiet);
    return name;
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function installAgentFromSource(source: AgentInstallSource, options: InstallOptions = {}) {
  const quiet = !!options.quiet;
  const tempDir = path.join(tmpdir(), `openbot-agent-install-${Date.now()}`);
  const baseDir = getBaseDir();
  const agentRoot = path.join(baseDir, "agents");
  await fs.mkdir(agentRoot, { recursive: true });

  try {
    log(`🤖 Installing agent from: ${githubRepoToCloneUrl(source.value)}`, quiet);
    run("git", ["clone", "--depth", "1", githubRepoToCloneUrl(source.value), tempDir], { quiet });

    const config = await readAgentConfig(tempDir);
    const name = config.name || path.basename(source.value).replace(/^agent-/, "");
    const targetDir = path.join(agentRoot, name);
    if (await directoryExists(targetDir)) {
      log(`⚠️  Agent "${name}" already exists. Overwriting...`, quiet);
      await fs.rm(targetDir, { recursive: true, force: true });
    }

    await fs.rename(tempDir, targetDir);
    log(`✅ Moved to: ${targetDir}`, quiet);
    await installMissingPluginsFromAgent(targetDir, { quiet });
    log(`\n🎉 Successfully installed agent: ${name}`, quiet);
    return name;
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

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

    const pluginPath = path.join(baseDir, "plugins", pluginName);
    const existsLocally = await directoryExists(pluginPath);
    if (existsLocally) continue;

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

    log(`⚠️  Could not find plugin "${pluginName}" for this agent. You may need to install it manually.`, quiet);
  }
}
