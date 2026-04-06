import { osAgent } from "../agents/os-agent.js";
import { agentCreatorAgent } from "../agents/agent-creator.js";
import { shellToolDefinitions } from "../plugins/shell.js";
import { fileSystemToolDefinitions } from "../plugins/file-system.js";
import { RuntimeRegistry } from "../registry/runtime-registry.js";
import {
  discoverAgents,
  registerOpenBotRootDefaultAgent,
} from "../registry/agent-loader.js";
import path from "node:path";

/**
 * Register built-in and custom agents.
 */
export async function registerAgents(
  registry: RuntimeRegistry,
  resolvedBaseDir: string,
  model: any,
  resolvedModelId: string,
  options?: { openaiApiKey?: string; anthropicApiKey?: string },
): Promise<void> {
  registry.registerAgent({
    id: "os",
    name: "os",
    description: "Handles shell commands and file system operations",
    capabilities: {
      ...Object.fromEntries(
        Object.entries(shellToolDefinitions).map(([k, v]) => [k, v.description]),
      ),
      ...Object.fromEntries(
        Object.entries(fileSystemToolDefinitions).map(([k, v]) => [k, v.description]),
      ),
    },
    plugin: osAgent({ model, resolvedModelId, resolvedBaseDir, registry }),
    isBuiltIn: true,
  });

  registry.registerAgent({
    id: "agent-creator",
    name: "agent-creator",
    description: "Helps the user create and update custom OpenBot agents via natural language.",
    capabilities: {
      ...Object.fromEntries(
        Object.entries(fileSystemToolDefinitions).map(([k, v]) => [k, v.description]),
      ),
    },
    plugin: agentCreatorAgent({ model, resolvedModelId, resolvedBaseDir, registry }),
    isBuiltIn: true,
  });

  await discoverAgents(path.join(resolvedBaseDir, "agents"), registry, model, resolvedModelId, resolvedBaseDir, options);
  await registerOpenBotRootDefaultAgent(registry, resolvedBaseDir, model, resolvedModelId, options);
}
