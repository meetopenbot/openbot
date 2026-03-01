import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { LanguageModel } from "ai";
import { MelonyPlugin } from "melony";
import { AgentRegistryEntry } from "./agent-registry.js";
import { ensurePluginReady } from "./plugin-loader.js";
import { ChatState, ChatEvent } from "../types.js";

/**
 * Expected export from a TS Agent package.
 */
export interface TSAgentDefinition {
  name?: string;
  description?: string;
  /** Factory that returns the agent plugin, given a model. */
  factory: (options: { model: LanguageModel; [key: string]: any }) => MelonyPlugin<ChatState, ChatEvent>;
  /** Optional tool capabilities for the manager to see */
  capabilities?: Record<string, string>;
  /** Optional events to subscribe to */
  subscribe?: string[];
}

/**
 * Discover and load TS-defined agents from a directory.
 *
 * Scans each subdirectory for a package.json and an index file.
 *
 * @param agentsDir Absolute path to the agents directory (e.g. ~/.openbot/agents)
 * @param defaultModel Language model to use for agent LLMs
 * @param options Optional API keys for creating specific models
 * @returns Array of discovered agent entries ready for registration
 */
export async function discoverTsAgents(
  agentsDir: string,
  defaultModel: LanguageModel,
  options?: { openaiApiKey?: string; anthropicApiKey?: string },
): Promise<AgentRegistryEntry[]> {
  const agents: AgentRegistryEntry[] = [];

  try {
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;

      const agentDir = path.join(agentsDir, entry.name);
      
      // We only consider it a TS agent if it doesn't have an AGENT.md
      // (This avoids double-loading if someone has both for some reason)
      const mdPath = path.join(agentDir, "AGENT.md");
      const hasMd = await fs.access(mdPath).then(() => true).catch(() => false);
      if (hasMd) continue;

      // Check for package.json to see if it's a package
      const pkgPath = path.join(agentDir, "package.json");
      const hasPackageJson = await fs.access(pkgPath).then(() => true).catch(() => false);
      if (!hasPackageJson) continue;

      try {
        // 1. Ensure dependencies and build are ready
        await ensurePluginReady(agentDir);

        // 2. Find index file
        let indexPath: string | undefined;
        const possibleIndices = ["dist/index.js", "index.js", "index.ts"];
        
        for (const file of possibleIndices) {
          try {
            const fullPath = path.join(agentDir, file);
            await fs.access(fullPath);
            indexPath = fullPath;
            break;
          } catch {
            continue;
          }
        }

        if (!indexPath) continue;

        // 3. Import and instantiate
        const moduleUrl = pathToFileURL(indexPath).href;
        const module = await import(moduleUrl);
        
        // Support 'agent', 'plugin', 'default', or 'entry'
        const definition: TSAgentDefinition = module.agent || module.plugin || module.default || module.entry;
        
        if (definition && typeof definition.factory === "function") {
          const name = definition.name || entry.name;
          const description = definition.description || "TS Agent";

          agents.push({
            name,
            description,
            plugin: definition.factory({ ...options, model: defaultModel }),
            capabilities: definition.capabilities,
            subscribe: definition.subscribe,
          });

          console.log(`[agents] Loaded TS agent: ${name} — ${description}`);
        }
      } catch (err) {
        console.warn(`[agents] Failed to load TS agent package "${entry.name}":`, err);
      }
    }
  } catch {
    // Agents directory doesn't exist
  }

  return agents;
}
