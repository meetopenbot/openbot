#!/usr/bin/env node
import { Command } from "commander";
import * as readline from "node:readline/promises";
import { saveConfig } from "./config.js";
import { startServer } from "./server.js";

const program = new Command();

program
  .name("openbot")
  .description("OpenBot CLI - Secure and easy configuration")
  .version("0.1.20");

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

program.parse();
