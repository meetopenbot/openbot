import { shellPlugin, shellToolDefinitions } from "../plugins/shell/index.js";
import { fileSystemPlugin, fileSystemToolDefinitions } from "../plugins/file-system/index.js";
import { approvalPlugin } from "../plugins/approval/index.js";
import { osAgent } from "../agents/os-agent.js";
import { agentCreatorAgent } from "../agents/agent-creator.js";
import { plannerAgent } from "../agents/planner-agent.js";
import { PluginRegistry, discoverPlugins } from "../registry/index.js";
import path from "node:path";

/**
 * Build the unified plugin registry.
 *
 * Registers built-in tools and agents, then discovers community
 * plugins (tools + agents) from ~/.openbot/plugins/.
 */
export async function setupPluginRegistry(
  resolvedBaseDir: string,
  model: any,
  options?: { openaiApiKey?: string; anthropicApiKey?: string },
): Promise<PluginRegistry> {
  const registry = new PluginRegistry();

  // ── Built-in tools ───────────────────────────────────────────────

  registry.register({
    name: "shell",
    description: "Execute shell commands",
    type: "tool",
    toolDefinitions: shellToolDefinitions,
    plugin: () => shellPlugin({ cwd: process.cwd() }),
    isBuiltIn: true,
  });

  registry.register({
    name: "file-system",
    description: "Read, write, list, and delete files",
    type: "tool",
    toolDefinitions: fileSystemToolDefinitions,
    plugin: () => fileSystemPlugin({ baseDir: "/" }),
    isBuiltIn: true,
  });

  registry.register({
    name: "approval",
    description: "Require user approval for specific actions",
    type: "tool",
    toolDefinitions: {},
    plugin: (opts) => approvalPlugin(opts),
    isBuiltIn: true,
  });

  // ── Built-in agents ──────────────────────────────────────────────

  registry.register({
    name: "os",
    description: "Handles shell commands and file system operations",
    type: "agent",
    capabilities: {
      ...Object.fromEntries(
        Object.entries(shellToolDefinitions).map(([k, v]) => [k, v.description]),
      ),
      ...Object.fromEntries(
        Object.entries(fileSystemToolDefinitions).map(([k, v]) => [k, v.description]),
      ),
    },
    plugin: osAgent({ model }),
    isBuiltIn: true,
  });

  registry.register({
    name: "agent-creator",
    description: "Helps the user create and update custom OpenBot agents via natural language.",
    type: "agent",
    capabilities: {
      ...Object.fromEntries(
        Object.entries(fileSystemToolDefinitions).map(([k, v]) => [k, v.description]),
      ),
    },
    plugin: agentCreatorAgent({ model }),
    isBuiltIn: true,
  });

  registry.register({
    name: "planner-agent",
    description: "Creates concise execution plans from user intent for OpenBot to run.",
    type: "agent",
    plugin: plannerAgent({ model }),
    isBuiltIn: true,
  });

  // ── Community plugins from ~/.openbot/plugins/ ───────────────────

  const pluginsDir = path.join(resolvedBaseDir, "plugins");
  await discoverPlugins(pluginsDir, registry, model, options);

  return registry;
}
