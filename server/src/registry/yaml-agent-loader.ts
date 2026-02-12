import * as fs from "node:fs/promises";
import * as path from "node:path";
import yaml from "js-yaml";
import { MelonyPlugin } from "melony";
import { LanguageModel } from "ai";
import { llmPlugin } from "../plugins/llm/index.js";
import { PluginRegistry } from "./plugin-registry.js";
import { AgentRegistryEntry } from "./agent-registry.js";
import { createModel } from "../models.js";

/**
 * Shape of an agent.yaml configuration file.
 *
 * Example:
 * ```yaml
 * name: code-review
 * description: Reviews code for quality, bugs, and best practices
 * model: gpt-4o # Optional: specific model for this agent
 * plugins:
 *   - shell
 *   - file-system
 * systemPrompt: |
 *   You are a Code Review Agent...
 * ```
 */
interface AgentYamlConfig {
  name: string;
  description: string;
  model?: string;
  plugins: string[];
  systemPrompt: string;
}

/**
 * Discover and load YAML-defined agents from a directory.
 *
 * Scans `agentsDir` for subdirectories containing an `agent.yaml` file,
 * parses each one, and composes a Melony plugin from the referenced plugins.
 *
 * @param agentsDir  Absolute path to the agents directory (e.g. ~/.openbot/agents)
 * @param pluginRegistry  Registry of available plugins
 * @param defaultModel  Language model to use for agent LLMs if not specified in YAML
 * @param options  Optional API keys for creating specific models
 * @returns Array of discovered agent entries ready for registration
 */
export async function discoverYamlAgents(
  agentsDir: string,
  pluginRegistry: PluginRegistry,
  defaultModel: LanguageModel,
  options?: { openaiApiKey?: string; anthropicApiKey?: string },
): Promise<AgentRegistryEntry[]> {
  const agents: AgentRegistryEntry[] = [];

  // Ensure the agents directory exists
  try {
    await fs.mkdir(agentsDir, { recursive: true });
  } catch {
    // Best effort
  }

  try {
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;

      const yamlPath = path.join(agentsDir, entry.name, "agent.yaml");

      try {
        const content = await fs.readFile(yamlPath, "utf-8");
        const config = yaml.load(content) as AgentYamlConfig;

        // Validate required fields
        if (!config.name || !config.description || !config.plugins?.length || !config.systemPrompt) {
          console.warn(`[agents] "${entry.name}/agent.yaml": missing required fields (name, description, plugins, systemPrompt) — skipping`);
          continue;
        }

        // Use agent-specific model if defined, otherwise use default
        const agentModel = config.model
          ? createModel({ ...options, model: config.model })
          : defaultModel;

        const plugin = composeAgentFromYaml(config, pluginRegistry, agentModel as LanguageModel);

        agents.push({
          name: config.name,
          description: config.description,
          plugin,
        });

        console.log(`[agents] Loaded: ${config.name} — ${config.description}${config.model ? ` (model: ${config.model})` : ""}`);
      } catch (err) {
        // Invalid or missing agent.yaml — silently skip
        console.warn(`[agents] Error loading "${entry.name}/agent.yaml":`, err);
      }
    }
  } catch {
    // Agents directory doesn't exist or can't be read — that's fine
  }

  return agents;
}

/**
 * Compose a Melony plugin from a YAML agent configuration.
 *
 * Resolves each plugin name against the registry, collects their tool definitions,
 * and wires them with an agent-scoped LLM plugin.
 */
function composeAgentFromYaml(
  config: AgentYamlConfig,
  pluginRegistry: PluginRegistry,
  model: LanguageModel,
): MelonyPlugin<any, any> {
  return (builder) => {
    const allToolDefinitions: Record<string, any> = {};

    for (const pluginName of config.plugins) {
      const entry = pluginRegistry.get(pluginName);

      if (!entry) {
        console.warn(`[agents] "${config.name}": plugin "${pluginName}" not found in registry — skipping`);
        continue;
      }

      // Register the plugin's event handlers
      builder.use(entry.factory());

      // Register UI plugin if available
      if (entry.uiFactory) {
        builder.use(entry.uiFactory());
      }

      // Collect tool definitions for the LLM
      Object.assign(allToolDefinitions, entry.toolDefinitions);
    }

    // Wire up the LLM with agent-scoped event channels
    builder.use(llmPlugin({
      model,
      system: config.systemPrompt,
      toolDefinitions: allToolDefinitions,
      promptInputType: `agent:${config.name}:input`,
      actionResultInputType: `agent:${config.name}:result`,
      completionEventType: `agent:${config.name}:output`,
    }));
  };
}
