#!/usr/bin/env node
import { Command } from "commander";
import * as readline from "node:readline/promises";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { saveConfig, resolvePath, DEFAULT_BASE_DIR } from "./config.js";
import { startServer } from "./server.js";
import { ensurePluginReady, getPluginMetadata } from "./registry/plugin-loader.js";
import { readAgentConfig } from "./registry/yaml-agent-loader.js";

const program = new Command();

program
  .name("openbot")
  .description("OpenBot CLI - Secure and easy configuration")
  .version("0.1.27");

/**
 * Check if a GitHub repository exists.
 */
function checkGitHubRepo(repo: string): boolean {
  try {
    execSync(`git ls-remote https://github.com/${repo}.git`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if an NPM package exists.
 */
function checkNpmPackage(pkg: string): boolean {
  try {
    execSync(`npm show ${pkg} version`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install a plugin from a source (GitHub, local, or NPM).
 */
async function installPlugin(source: string, quiet = false) {
  const isGitHub = (source.includes("/") || source.startsWith("github:")) && !source.startsWith("/") && !source.startsWith(".");
  const isNpm = source.startsWith("@") || source.startsWith("npm:");
  
  const repoUrl = isGitHub 
    ? (source.startsWith("github:") ? `https://github.com/${source.slice(7)}.git` : `https://github.com/${source}.git`)
    : source;

  const tempDir = path.join(tmpdir(), `openbot-plugin-install-${Date.now()}`);

  try {
    if (!quiet) console.log(`📦 Installing plugin from: ${isNpm ? source : repoUrl}`);

    // 1. Fetch to temp directory
    if (isGitHub) {
      execSync(`git clone --depth 1 ${repoUrl} ${tempDir}`, { stdio: quiet ? "ignore" : "inherit" });
    } else if (isNpm) {
      const pkgName = source.startsWith("npm:") ? source.slice(4) : source;
      await fs.mkdir(tempDir, { recursive: true });
      execSync(`npm install ${pkgName} --prefix ${tempDir}`, { stdio: quiet ? "ignore" : "inherit" });
      
      // Move from node_modules to tempDir root for consistency
      const pkgFolder = path.join(tempDir, "node_modules", pkgName);
      const moveTemp = path.join(tmpdir(), `openbot-npm-move-${Date.now()}`);
      await fs.rename(pkgFolder, moveTemp);
      await fs.rm(tempDir, { recursive: true, force: true });
      await fs.rename(moveTemp, tempDir);
    } else {
      const absoluteSource = path.resolve(source);
      await fs.mkdir(tempDir, { recursive: true });
      execSync(`cp -R ${absoluteSource}/. ${tempDir}`, { stdio: quiet ? "ignore" : "inherit" });
    }

    // 2. Identify name from metadata
    const { name } = await getPluginMetadata(tempDir);

    const baseDir = resolvePath(DEFAULT_BASE_DIR);
    const targetDir = path.join(baseDir, "plugins", name);

    // 3. Move to target directory
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    if (await fs.access(targetDir).then(() => true).catch(() => false)) {
      if (!quiet) console.log(`⚠️  Plugin "${name}" already exists. Overwriting...`);
      await fs.rm(targetDir, { recursive: true, force: true });
    }
    
    await fs.rename(tempDir, targetDir);
    if (!quiet) console.log(`✅ Moved to: ${targetDir}`);

    // 4. Prepare
    if (!quiet) console.log(`⚙️  Preparing plugin "${name}"...`);
    await ensurePluginReady(targetDir);

    if (!quiet) console.log(`\n🎉 Successfully installed plugin: ${name}`);
    return name;
  } catch (err) {
    if (!quiet) console.error("\n❌ Plugin installation failed:", err instanceof Error ? err.message : String(err));
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
    if (!quiet) process.exit(1);
    throw err;
  }
}

/**
 * Install an agent from a source (GitHub).
 */
async function installAgent(source: string) {
  const repoUrl = source.startsWith("github:") ? `https://github.com/${source.slice(7)}.git` : `https://github.com/${source}.git`;
  const tempDir = path.join(tmpdir(), `openbot-agent-install-${Date.now()}`);

  try {
    console.log(`🤖 Installing agent from: ${repoUrl}`);

    // 1. Clone to temp directory
    execSync(`git clone --depth 1 ${repoUrl} ${tempDir}`, { stdio: "inherit" });

    // 2. Identify name from agent.yaml
    const config = await readAgentConfig(tempDir);
    const name = config.name || path.basename(source.replace(".git", ""));

    const baseDir = resolvePath(DEFAULT_BASE_DIR);
    const targetDir = path.join(baseDir, "agents", name);

    // 3. Move to target directory
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    if (await fs.access(targetDir).then(() => true).catch(() => false)) {
      console.log(`⚠️  Agent "${name}" already exists. Overwriting...`);
      await fs.rm(targetDir, { recursive: true, force: true });
    }
    
    await fs.rename(tempDir, targetDir);
    console.log(`✅ Moved to: ${targetDir}`);

    // 4. Recursive plugin installation
    if (config.plugins && Array.isArray(config.plugins)) {
      for (const pluginItem of config.plugins) {
        const pluginName = typeof pluginItem === "string" ? pluginItem : pluginItem.name;
        
        // Skip built-in plugins
        if (["shell", "file-system"].includes(pluginName)) continue;

        // Check if plugin exists locally
        const pluginPath = path.join(baseDir, "plugins", pluginName);
        const existsLocally = await fs.access(pluginPath).then(() => true).catch(() => false);
        
        if (!existsLocally) {
          console.log(`🔍 Agent needs plugin "${pluginName}". Searching...`);
          
          // Try GitHub
          const ghRepo = `meetopenbot/plugin-${pluginName}`;
          if (checkGitHubRepo(ghRepo)) {
            await installPlugin(ghRepo);
            continue;
          }

          // Try NPM
          const npmPkg = `@melony/plugin-${pluginName}`;
          if (checkNpmPackage(npmPkg)) {
            await installPlugin(npmPkg);
            continue;
          }

          console.warn(`⚠️  Could not find plugin "${pluginName}" for agent "${name}". You may need to install it manually.`);
        }
      }
    }

    console.log(`\n🎉 Successfully installed agent: ${name}`);
    return name;
  } catch (err) {
    console.error("\n❌ Agent installation failed:", err instanceof Error ? err.message : String(err));
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
    process.exit(1);
  }
}

program
  .command("configure")
  .description("Configure OpenBot model and settings")
  .action(async () => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log("------------------------------------------");
    console.log("🍎 OpenBot Configuration");
    console.log("------------------------------------------");

    const models = [
      { name: "GPT-5 Nano (OpenAI)", value: "openai/gpt-5-nano" },
      { name: "GPT-4o (OpenAI)", value: "openai/gpt-4o" },
      { name: "GPT-4o-mini (OpenAI)", value: "openai/gpt-4o-mini" },
      { name: "Claude Opus 4.5 (Anthropic)", value: "anthropic/claude-opus-4-5-20251101" },
      { name: "Claude Sonnet 4.5 (Anthropic)", value: "anthropic/claude-sonnet-4-5-20250929" },
      { name: "Claude 3.7 Sonnet (Anthropic)", value: "anthropic/claude-3-7-sonnet-20250219" },
      { name: "Claude 3.5 Sonnet (Anthropic)", value: "anthropic/claude-3-5-sonnet-20240620" },
    ];

    console.log("Please choose a model:");
    models.forEach((m, i) => console.log(`${i + 1}) ${m.name}`));

    const choice = await rl.question(`\nSelection (1-${models.length}): `);
    const selectedIndex = parseInt(choice) - 1;

    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= models.length) {
      console.error("❌ Invalid selection. Please run configure again.");
      rl.close();
      return;
    }

    const selectedModel = models[selectedIndex].value;
    const provider = selectedModel.startsWith("openai") ? "openai" : "anthropic";

    saveConfig({
      model: selectedModel,
    });

    console.log("\n✅ Configuration saved!");
    console.log(`Selected model: ${selectedModel}`);
    console.log("------------------------------------------");
    
    if (provider === "openai") {
      console.log("To start the server with your OpenAI key, use:");
      console.log(`\n  openbot server --openai-api-key YOUR_OPENAI_KEY\n`);
    } else {
      console.log("To start the server with your Anthropic key, use:");
      console.log(`\n  openbot server --anthropic-api-key YOUR_ANTHROPIC_KEY\n`);
    }
    
    console.log("Alternatively, you can set the environment variable:");
    console.log(provider === "openai" ? "  export OPENAI_API_KEY=your-key" : "  export ANTHROPIC_API_KEY=your-key");
    console.log("------------------------------------------");

    rl.close();
  });

program
  .command("server")
  .description("Start the OpenBot server")
  .option("-p, --port <number>", "Port to listen on")
  .option("--openai-api-key <key>", "OpenAI API Key")
  .option("--anthropic-api-key <key>", "Anthropic API Key")
  .action(async (options) => {
    await startServer(options);
  });

program
  .command("add <name>")
  .description("Add an agent or plugin by name (auto-resolves to GitHub/NPM)")
  .action(async (name: string) => {
    // 1. Try as Agent
    const agentRepo = `meetopenbot/agent-${name}`;
    if (checkGitHubRepo(agentRepo)) {
      await installAgent(agentRepo);
      return;
    }

    // 2. Try as Plugin
    const baseDir = resolvePath(DEFAULT_BASE_DIR);
    const pluginPath = path.join(baseDir, "plugins", name);
    const existsLocally = await fs.access(pluginPath).then(() => true).catch(() => false);

    if (existsLocally) {
      console.log(`✅ Plugin "${name}" is already installed locally.`);
      return;
    }

    // Check GitHub Plugin
    const pluginGhRepo = `meetopenbot/plugin-${name}`;
    if (checkGitHubRepo(pluginGhRepo)) {
      await installPlugin(pluginGhRepo);
      return;
    }

    // Check NPM Plugin
    const pluginNpmPkg = `@melony/plugin-${name}`;
    if (checkNpmPackage(pluginNpmPkg)) {
      await installPlugin(pluginNpmPkg);
      return;
    }

    console.error(`❌ Could not find agent or plugin named "${name}" in official repositories.`);
    process.exit(1);
  });

const plugin = program.command("plugin").description("Manage OpenBot plugins");

plugin
  .command("install <source>")
  .description("Install a shared plugin from GitHub (user/repo) or a local path")
  .action(async (source: string) => {
    await installPlugin(source);
  });

plugin
  .command("list")
  .description("List all installed shared plugins")
  .action(async () => {
    const baseDir = resolvePath(DEFAULT_BASE_DIR);
    const pluginsDir = path.join(baseDir, "plugins");

    try {
      await fs.access(pluginsDir);
    } catch {
      console.log("No shared plugins found.");
      return;
    }

    const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
    const plugins = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;

      const pluginDir = path.join(pluginsDir, entry.name);
      const { name, version, description } = await getPluginMetadata(pluginDir);
      plugins.push({ name, version, description });
    }

    if (plugins.length === 0) {
      console.log("No shared plugins found.");
      return;
    }

    console.log("\n🔌 Installed Shared Plugins:");
    console.log("------------------------------------------");
    for (const p of plugins) {
      console.log(`${p.name.padEnd(20)} (${p.version}) - ${p.description}`);
    }
    console.log("------------------------------------------\n");
  });

program.parse();
