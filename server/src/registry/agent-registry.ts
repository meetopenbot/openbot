export { PluginRegistry } from "./plugin-registry.js";
export type {
  PluginRegistryEntry,
  AnyPluginRegistryEntry,
  ToolPluginRegistryEntry,
  AgentPluginRegistryEntry,
} from "./plugin-registry.js";

export {
  discoverPlugins,
  listPlugins,
  readAgentConfig,
  getPluginMetadata,
  ensurePluginReady,
} from "./plugin-loader.js";

export type { AgentConfig, ListedPlugin } from "./plugin-loader.js";
