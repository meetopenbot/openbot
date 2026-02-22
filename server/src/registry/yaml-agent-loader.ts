import * as fs from "node:fs/promises";
import * as path from "node:path";
import yaml from "js-yaml";
import { MelonyPlugin } from "melony";
import { LanguageModel } from "ai";
import { llmPlugin } from "../plugins/llm/index.js";
import { PluginRegistry } from "./plugin-registry.js";
import { AgentRegistryEntry } from "./agent-registry.js";
import { createModel } from "../models.js";
import { loadPluginsFromDir } from "./plugin-loader.js";
import { resolvePath } from "../config.js";

/**
 * Recursively resolve tilde paths in a configuration object.
 */
function resolveConfigPaths(config: any): any {
  if (typeof config === "string") {
    return resolvePath(config);
  }
  if (Array.isArray(config)) {
    return config.map(resolveConfigPaths);
  }
  if (config !== null && typeof config === "object") {
    const resolved: any = {};
    for (const [key, value] of Object.entries(config)) {
      resolved[key] = resolveConfigPaths(value);
    }
    return resolved;
  }
  return config;
}

/**
 * Shape of an agent.yaml configuration file.
 */
export interface AgentYamlConfig {
  name: string;
  description: string;
  model?: string;
  plugins: (string | { name: string; config?: any })[];
  systemPrompt: string;
  subscribe?: string[];
}

/**
 * Read and parse an agent.yaml file from a directory.
 */
export async function readAgentConfig(agentDir: string): Promise<AgentYamlConfig> {
  const yamlPath = path.join(agentDir, "agent.yaml");
  const content = await fs.readFile(yamlPath, "utf-8");
  return yaml.load(content) as AgentYamlConfig;
}

/**
 * Discover YAML-defined agents from a directory without loading plugins.
 *
 * @param agentsDir  Absolute path to the agents directory (e.g. ~/.openbot/agents)
 * @returns Array of agent metadata
 */
export async function listYamlAgents(
  agentsDir: string,
): Promise<{ name: string; description: string; folder: string }[]> {
  const agents: { name: string; description: string; folder: string }[] = [];

  try {
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;

      const agentDir = path.join(agentsDir, entry.name);

      try {
        const config = await readAgentConfig(agentDir);

        if (config.name && config.description) {
          agents.push({
            name: config.name,
            description: config.description,
            folder: agentDir,
          });
        }
      } catch {
        // Skip invalid agents
      }
    }
  } catch {
    // Agents directory doesn't exist
  }

  return agents;
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
      const agentDir = path.join(agentsDir, entry.name);

      try {
        const config = await readAgentConfig(agentDir);

        // Validate required fields
        if (!config.name || !config.description || !config.plugins?.length || !config.systemPrompt) {
          console.warn(`[agents] "${entry.name}/agent.yaml": missing required fields (name, description, plugins, systemPrompt) — skipping`);
          continue;
        }

        const agentModel = config.model
          ? createModel({ ...options, model: config.model })
          : defaultModel;

        // 1. Load local plugins from agents/<name>/plugins/
        const localPluginsDir = path.join(agentDir, "plugins");
        const localPlugins = await loadPluginsFromDir(localPluginsDir);

        // 2. Create a scoped registry for this agent: global + local
        const scopedRegistry = new PluginRegistry();
        
        // Add all global plugins
        for (const p of pluginRegistry.getAll()) {
          scopedRegistry.register(p);
        }
        
        // Add local plugins (overwriting globals if names conflict)
        for (const p of localPlugins) {
          scopedRegistry.register(p);
        }

        const { plugin, toolDefinitions } = composeAgentFromYaml(config, scopedRegistry, agentModel as LanguageModel);

        agents.push({
          name: config.name,
          description: config.description,
          plugin,
          capabilities: Object.fromEntries(
            Object.entries(toolDefinitions).map(([name, def]) => [
              name,
              (def as any).description,
            ])
          ),
          subscribe: config.subscribe,
        });

        console.log(`[agents] Loaded: ${config.name} — ${config.description}${config.model ? ` (model: ${config.model})` : ""}`);
      } catch (err: any) {
        // Invalid or missing agent.yaml — silently skip if missing, warn if invalid
        if (err.code !== 'ENOENT') {
          console.warn(`[agents] Error loading "${entry.name}/agent.yaml":`, err);
        }
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
): { plugin: MelonyPlugin<any, any>; toolDefinitions: Record<string, any> } {
  const allToolDefinitions: Record<string, any> = {};
  const pluginFactories: { factory: any; config: any }[] = [];

  for (const pluginItem of config.plugins) {
    const isString = typeof pluginItem === "string";
    const pluginName = isString ? pluginItem : pluginItem.name;
    const pluginConfig = isString ? {} : (pluginItem.config || {});
    const resolvedConfig = resolveConfigPaths(pluginConfig);

    const entry = pluginRegistry.get(pluginName);

    if (!entry) {
      console.warn(`[agents] "${config.name}": plugin "${pluginName}" not found in registry — skipping`);
      continue;
    }

    pluginFactories.push({ factory: entry.factory, config: resolvedConfig });
    Object.assign(allToolDefinitions, entry.toolDefinitions);
  }

  const plugin: MelonyPlugin<any, any> = (builder) => {
    for (const { factory, config: resolvedConfig } of pluginFactories) {
      builder.use(factory({ ...resolvedConfig, model }));
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

  return { plugin, toolDefinitions: allToolDefinitions };
}
