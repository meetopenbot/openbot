import { shellPlugin, shellToolDefinitions } from "../plugins/shell.js";
import { fileSystemPlugin, fileSystemToolDefinitions } from "../plugins/file-system.js";
import { channelPlugin, channelToolDefinitions } from "../plugins/channel.js";
import { approvalPlugin } from "../plugins/approval.js";
import { osAgent } from "../agents/os-agent.js";
import { agentCreatorAgent } from "../agents/agent-creator.js";
import { PluginRegistry } from "../registry/plugin-registry.js";
import { discoverPlugins, registerOpenBotRootDefaultAgent } from "../registry/plugin-loader.js";
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
  resolvedModelId: string, // Add this
  options?: { openaiApiKey?: string; anthropicApiKey?: string },
): Promise<PluginRegistry> {
  const registry = new PluginRegistry();

  // ── Built-in tools ───────────────────────────────────────────────

  registry.register({
    id: "shell",
    name: "shell",
    description: "Execute shell commands",
    type: "tool",
    toolDefinitions: shellToolDefinitions,
    plugin: () => shellPlugin({ cwd: process.cwd() }),
    isBuiltIn: true,
  });

  registry.register({
    id: "file-system",
    name: "file-system",
    description: "Read, write, list, and delete files",
    type: "tool",
    toolDefinitions: fileSystemToolDefinitions,
    plugin: () => fileSystemPlugin({ baseDir: "/" }),
    isBuiltIn: true,
  });

  registry.register({
    id: "approval",
    name: "approval",
    description: "Require user approval for specific actions",
    type: "tool",
    toolDefinitions: {},
    plugin: (opts) => approvalPlugin(opts),
    isBuiltIn: true,
  });

  registry.register({
    id: "channel",
    name: "channel",
    description: "Create and manage channels",
    type: "tool",
    toolDefinitions: channelToolDefinitions,
    plugin: () => channelPlugin(),
    isBuiltIn: true,
  });

  // ── Built-in agents ──────────────────────────────────────────────

  registry.register({
    id: "os",
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
    plugin: osAgent({ model, resolvedModelId, resolvedBaseDir, registry }),
    isBuiltIn: true,
  });

  registry.register({
    id: "agent-creator",
    name: "agent-creator",
    description: "Helps the user create and update custom OpenBot agents via natural language.",
    type: "agent",
    capabilities: {
      ...Object.fromEntries(
        Object.entries(fileSystemToolDefinitions).map(([k, v]) => [k, v.description]),
      ),
    },
    plugin: agentCreatorAgent({ model, resolvedModelId, resolvedBaseDir, registry }),
    isBuiltIn: true,
  });

  // ── Custom agents and plugins ────────────────────────────────────

  const agentsDir = path.join(resolvedBaseDir, "agents");
  const pluginsDir = path.join(resolvedBaseDir, "plugins");

  await discoverPlugins(pluginsDir, registry, model, resolvedModelId, resolvedBaseDir, options);
  await discoverPlugins(agentsDir, registry, model, resolvedModelId, resolvedBaseDir, options);
  await registerOpenBotRootDefaultAgent(registry, resolvedBaseDir, model, resolvedModelId, options);

  return registry;
}
