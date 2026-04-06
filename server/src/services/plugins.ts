import { shellPlugin, shellToolDefinitions } from "../plugins/shell.js";
import { fileSystemPlugin, fileSystemToolDefinitions } from "../plugins/file-system.js";
import { channelPlugin, channelToolDefinitions } from "../plugins/channel.js";
import { approvalPlugin } from "../plugins/approval.js";
import { RuntimeRegistry } from "../registry/runtime-registry.js";
import {
  discoverToolPlugins,
} from "../registry/plugin-loader.js";
import path from "node:path";

/**
 * Register built-in and custom tool plugins.
 */
export async function registerPlugins(
  registry: RuntimeRegistry,
  resolvedBaseDir: string,
): Promise<void> {

  // ── Built-in tools ───────────────────────────────────────────────

  registry.registerTool({
    id: "shell",
    name: "shell",
    description: "Execute shell commands",
    toolDefinitions: shellToolDefinitions,
    plugin: () => shellPlugin({ cwd: process.cwd() }),
    isBuiltIn: true,
  });

  registry.registerTool({
    id: "file-system",
    name: "file-system",
    description: "Read, write, list, and delete files",
    toolDefinitions: fileSystemToolDefinitions,
    plugin: () => fileSystemPlugin({ baseDir: "/" }),
    isBuiltIn: true,
  });

  registry.registerTool({
    id: "approval",
    name: "approval",
    description: "Require user approval for specific actions",
    toolDefinitions: {},
    plugin: (opts) => approvalPlugin(opts),
    isBuiltIn: true,
  });

  registry.registerTool({
    id: "channel",
    name: "channel",
    description: "Create and manage channels",
    toolDefinitions: channelToolDefinitions,
    plugin: () => channelPlugin(),
    isBuiltIn: true,
  });

  // ── Custom tool plugins ──────────────────────────────────────────
  const pluginsDir = path.join(resolvedBaseDir, "plugins");

  await discoverToolPlugins(pluginsDir, registry);
}
