import { shellPlugin, shellToolDefinitions } from "../plugins/shell/index.js";
import { fileSystemPlugin, fileSystemToolDefinitions } from "../plugins/file-system/index.js";
import { approvalPlugin } from "../plugins/approval/index.js";
import { PluginRegistry, loadPluginsFromDir } from "../registry/index.js";
import path from "node:path";

export async function setupPluginRegistry(resolvedBaseDir: string): Promise<PluginRegistry> {
  const pluginRegistry = new PluginRegistry();

  pluginRegistry.register({
    name: "shell",
    description: "Execute shell commands",
    toolDefinitions: shellToolDefinitions,
    factory: () => shellPlugin({ cwd: process.cwd() }),
  });

  pluginRegistry.register({
    name: "file-system",
    description: "Read, write, list, and delete files",
    toolDefinitions: fileSystemToolDefinitions,
    factory: () => fileSystemPlugin({ baseDir: "/" }),
  });

  pluginRegistry.register({
    name: "approval",
    description: "Require user approval for specific actions",
    toolDefinitions: {},
    factory: (options) => approvalPlugin(options),
  });

  const sharedPlugins = await loadPluginsFromDir(path.join(resolvedBaseDir, "plugins"));
  for (const p of sharedPlugins) {
    pluginRegistry.register(p);
    console.log(`[plugins] Loaded shared plugin: ${p.name}`);
  }

  return pluginRegistry;
}
