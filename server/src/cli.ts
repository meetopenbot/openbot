#!/usr/bin/env node
import { Command } from "commander";
import * as readline from "node:readline/promises";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { saveConfig, resolvePath, DEFAULT_BASE_DIR } from "./config.js";
import { startServer } from "./server.js";
import { ensurePluginReady } from "./registry/plugin-loader.js";

const program = new Command();

program
  .name("openbot")
  .description("OpenBot CLI - Secure and easy configuration")
  .version("0.1.23");

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
      { name: "GPT-5 Nano (OpenAI)", value: "openai:gpt-5-nano" },
      { name: "GPT-4o (OpenAI)", value: "openai:gpt-4o" },
      { name: "GPT-4o-mini (OpenAI)", value: "openai:gpt-4o-mini" },
      { name: "Claude Opus 4.5 (Anthropic)", value: "anthropic:claude-opus-4-5-20251101" },
      { name: "Claude Sonnet 4.5 (Anthropic)", value: "anthropic:claude-sonnet-4-5-20250929" },
      { name: "Claude 3.7 Sonnet (Anthropic)", value: "anthropic:claude-3-7-sonnet-20250219" },
      { name: "Claude 3.5 Sonnet (Anthropic)", value: "anthropic:claude-3-5-sonnet-20240620" },
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

const plugin = program.command("plugin").description("Manage OpenBot plugins");

plugin
  .command("install <source>")
  .description("Install a shared plugin from GitHub (user/repo) or a local path")
  .action(async (source: string) => {
    const isGitHub = source.includes("/") && !source.startsWith("/") && !source.startsWith(".");
    const repoUrl = isGitHub ? `https://github.com/${source}.git` : source;
    const tempDir = path.join(tmpdir(), `openbot-plugin-install-${Date.now()}`);

    try {
      console.log(`📦 Installing plugin from: ${repoUrl}`);

      // 1. Clone or copy to temp directory
      if (isGitHub) {
        execSync(`git clone --depth 1 ${repoUrl} ${tempDir}`, { stdio: "inherit" });
      } else {
        const absoluteSource = path.resolve(source);
        await fs.mkdir(tempDir, { recursive: true });
        execSync(`cp -R ${absoluteSource}/. ${tempDir}`, { stdio: "inherit" });
      }

      // 2. Identify name from package.json
      let name = path.basename(source.replace(".git", ""));
      const pkgPath = path.join(tempDir, "package.json");
      if (await fs.access(pkgPath).then(() => true).catch(() => false)) {
        try {
          const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
          if (pkg.name) name = pkg.name.split("/").pop(); // Use last part of scoped names
        } catch {
          // Fallback to source basename
        }
      }

      const baseDir = resolvePath(DEFAULT_BASE_DIR);
      const targetDir = path.join(baseDir, "plugins", name);

      // 3. Move to target directory
      await fs.mkdir(path.dirname(targetDir), { recursive: true });
      if (await fs.access(targetDir).then(() => true).catch(() => false)) {
        console.log(`⚠️  Plugin "${name}" already exists. Overwriting...`);
        await fs.rm(targetDir, { recursive: true, force: true });
      }
      
      await fs.rename(tempDir, targetDir);
      console.log(`✅ Moved to: ${targetDir}`);

      // 4. Prepare
      console.log(`⚙️  Preparing plugin "${name}"...`);
      await ensurePluginReady(targetDir);

      console.log(`\n🎉 Successfully installed plugin: ${name}`);
      console.log(`This plugin is now available to all agents.`);
    } catch (err) {
      console.error("\n❌ Plugin installation failed:", err instanceof Error ? err.message : String(err));
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch { /* ignore */ }
      process.exit(1);
    }
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

      const pkgPath = path.join(pluginsDir, entry.name, "package.json");
      let description = "No description";
      let version = "0.0.0";

      try {
        const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
        description = pkg.description || description;
        version = pkg.version || version;
      } catch {
        // Use defaults
      }

      plugins.push({ name: entry.name, version, description });
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
