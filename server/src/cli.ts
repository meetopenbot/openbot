#!/usr/bin/env node
import { Command } from "commander";
import * as readline from "node:readline/promises";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { saveConfig, resolvePath, DEFAULT_BASE_DIR } from "./config.js";
import { startServer } from "./server.js";
import { getPluginMetadata } from "./registry/plugin-loader.js";
import {
  checkGitHubRepo,
  checkNpmPackage,
  parsePluginInstallSource,
  parseAgentInstallSource,
  installPluginFromSource,
  installAgentFromSource,
} from "./installers.js";

const program = new Command();
const REQUIRED_NODE_VERSION = "20.12.0";

function checkNodeVersion() {
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  const [reqMajor, reqMinor, reqPatch] = REQUIRED_NODE_VERSION.split(".").map(Number);

  const isOld = 
    major < reqMajor || 
    (major === reqMajor && minor < reqMinor) || 
    (major === reqMajor && minor === reqMinor && patch < reqPatch);

  if (isOld) {
    console.warn(`\n⚠️  WARNING: You are using Node.js ${process.version}.`);
    console.warn(`   OpenBot works best with Node.js >=${REQUIRED_NODE_VERSION}.`);
    console.warn(`   You may encounter "ERR_REQUIRE_ESM" or other compatibility issues on older versions.\n`);
  }
}

checkNodeVersion();

program
  .name("openbot")
  .description("OpenBot CLI - Secure and easy configuration")
  .version("0.2.7");

async function installPlugin(source: string, id?: string, quiet = false) {
  try {
    const parsed = parsePluginInstallSource(source);
    const name = await installPluginFromSource(parsed, { quiet, id });
    return name;
  } catch (err) {
    if (!quiet) console.error("\n❌ Plugin installation failed:", err instanceof Error ? err.message : String(err));
    if (!quiet) process.exit(1);
    throw err;
  }
}

async function installAgent(source: string, id?: string) {
  try {
    const parsed = parseAgentInstallSource(source);
    const name = await installAgentFromSource(parsed, { id });
    return name;
  } catch (err) {
    console.error("\n❌ Agent installation failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function shellEscape(arg: string) {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
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
    console.log("\n🚀 TIP: Use 'openbot up' to start the server and web UI together.");
    console.log("------------------------------------------\n");

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
  .command("up")
  .description("Start OpenBot server and web dashboard together")
  .option("-p, --port <number>", "Port to listen on")
  .option("--openai-api-key <key>", "OpenAI API Key")
  .option("--anthropic-api-key <key>", "Anthropic API Key")
  .action(async (options) => {
    const serverArgs = ["openbot", "server"];
    if (options.port) serverArgs.push("--port", String(options.port));
    if (options.openaiApiKey) serverArgs.push("--openai-api-key", options.openaiApiKey);
    if (options.anthropicApiKey) serverArgs.push("--anthropic-api-key", options.anthropicApiKey);

    const serverCommand = serverArgs.map(shellEscape).join(" ");

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "npx",
        [
          "-y",
          "concurrently",
          "--kill-others",
          "--names",
          "SERVER,WEBUI",
          "--prefix",
          "{name}",
          "--prefix-colors",
          "blue.bold,green.bold",
          serverCommand,
          "openbot-web",
        ],
        { stdio: "inherit" }
      );

      child.on("error", reject);
      child.on("exit", (code) => {
        if (typeof code === "number") process.exitCode = code;
        resolve();
      });
    });
  });

program
  .command("add <name>")
  .description("Add an agent or plugin by name (auto-resolves to GitHub/NPM)")
  .action(async (name: string) => {
    // 1. Try as Agent
    const agentRepo = `meetopenbot/agent-${name}`;
    if (checkGitHubRepo(agentRepo)) {
      await installAgent(agentRepo, `agent-${name}`);
      return;
    }

    // 2. Try as Plugin
    const baseDir = resolvePath(DEFAULT_BASE_DIR);
    const agentPath = path.join(baseDir, "agents", name);
    const pluginPath = path.join(baseDir, "plugins", name);
    const agentExists = await fs.access(agentPath).then(() => true).catch(() => false);
    const pluginExists = await fs.access(pluginPath).then(() => true).catch(() => false);

    if (agentExists || pluginExists) {
      console.log(`✅ Agent or Plugin "${name}" is already installed locally.`);
      return;
    }

    // Check GitHub Plugin
    const pluginGhRepo = `meetopenbot/plugin-${name}`;
    if (checkGitHubRepo(pluginGhRepo)) {
      await installPlugin(pluginGhRepo, `plugin-${name}`);
      return;
    }

    // Check NPM Plugin
    const pluginNpmPkg = `@melony/plugin-${name}`;
    if (checkNpmPackage(pluginNpmPkg)) {
      await installPlugin(pluginNpmPkg, `plugin-${name}`);
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

const agent = program.command("agent").description("Manage OpenBot agents");

agent
  .command("install <source>")
  .description("Install a custom agent from GitHub (user/repo) or a local path")
  .action(async (source: string) => {
    await installAgent(source);
  });

agent
  .command("list")
  .description("List all installed custom agents")
  .action(async () => {
    const baseDir = resolvePath(DEFAULT_BASE_DIR);
    const agentsDir = path.join(baseDir, "agents");

    try {
      await fs.access(agentsDir);
    } catch {
      console.log("No custom agents found.");
      return;
    }

    const entries = await fs.readdir(agentsDir, { withFileTypes: true });
    const agents = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;

      const agentDir = path.join(agentsDir, entry.name);
      const { name, version, description } = await getPluginMetadata(agentDir);
      agents.push({ name, version, description });
    }

    if (agents.length === 0) {
      console.log("No custom agents found.");
      return;
    }

    console.log("\n🤖 Installed Custom Agents:");
    console.log("------------------------------------------");
    for (const a of agents) {
      console.log(`${a.name.padEnd(20)} (${a.version}) - ${a.description}`);
    }
    console.log("------------------------------------------\n");
  });

program.parse();
