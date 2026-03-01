import * as fs from "node:fs/promises";
import * as path from "node:path";
import yaml from "js-yaml";
import matter from "gray-matter";
import { MelonyPlugin } from "melony";
import { LanguageModel } from "ai";
import { llmPlugin } from "../plugins/llm/index.js";
import { PluginRegistry } from "./plugin-registry.js";
import { AgentRegistryEntry } from "./agent-registry.js";
import { createModel } from "../models.js";
import { loadPluginsFromDir } from "./plugin-loader.js";
import { resolvePath, DEFAULT_AGENT_MD } from "../config.js";

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
 * Shape of an agent configuration (from AGENT.md frontmatter).
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
 * Read and parse an agent configuration from AGENT.md with frontmatter.
 */
export async function readAgentConfig(agentDir: string): Promise<AgentYamlConfig> {
  const mdPath = path.join(agentDir, "AGENT.md");
  const folderName = path.basename(agentDir);

  let mdContent = "";
  try {
    mdContent = await fs.readFile(mdPath, "utf-8");
  } catch {
    // Fallback to a default template if AGENT.md is missing
    mdContent = DEFAULT_AGENT_MD.replace("name: Agent", `name: ${folderName}`);
  }

  const parsed = matter(mdContent);
  const config = (parsed.data || {}) as Partial<AgentYamlConfig>;

  return {
    name: config.name || folderName,
    description: config.description || `The ${folderName} agent`,
    model: config.model,
    plugins: config.plugins || [],
    systemPrompt: parsed.content.trim() || "",
    subscribe: config.subscribe,
  };
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
  const seenNames = new Set<string>();

  try {
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;

      const agentDir = path.join(agentsDir, entry.name);

      try {
        const config = await readAgentConfig(agentDir);

        if (config.name && config.description && !seenNames.has(config.name)) {
          agents.push({
            name: config.name,
            description: config.description,
            folder: agentDir,
          });
          seenNames.add(config.name);
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
 * Scans `agentsDir` for subdirectories containing an `AGENT.md` file,
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
  const seenNames = new Set<string>();

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

      const agentDir = path.join(agentsDir, entry.name);

      try {
        const config = await readAgentConfig(agentDir);

        // Validate required fields and avoid duplicates
        if (!config.name || !config.description || seenNames.has(config.name)) {
          continue;
        }

        seenNames.add(config.name);

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

        // Initialize AGENT.md if it doesn't exist (using the template)
        const agentMdPath = path.join(agentDir, "AGENT.md");
        try {
          await fs.access(agentMdPath);
        } catch {
          const content = DEFAULT_AGENT_MD.replace("name: Agent", `name: ${config.name}`);
          await fs.writeFile(agentMdPath, content, "utf-8");
          console.log(`[agents] Initialized ${config.name}/AGENT.md`);
        }

        const { plugin, toolDefinitions } = composeAgentFromConfig(config, scopedRegistry, agentModel as LanguageModel);

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
        // Skip invalid agents
        if (err.code !== 'ENOENT') {
          console.warn(`[agents] Error loading "${entry.name}":`, err);
        }
      }
    }
  } catch {
    // Agents directory doesn't exist or can't be read — that's fine
  }

  return agents;
}

/**
 * Compose a Melony plugin from an agent configuration.
 *
 * Resolves each plugin name against the registry, collects their tool definitions,
 * and wires them with an agent-scoped LLM plugin.
 */
function composeAgentFromConfig(
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
    }));
  };

  return { plugin, toolDefinitions: allToolDefinitions };
}
