export { PluginRegistry } from "./plugin-registry.js";
export { RuntimeRegistry } from "./runtime-registry.js";
export type {
  PluginRegistryEntry,
  ToolPluginRegistryEntry,
} from "./plugin-registry.js";
export type { AgentRegistryEntry } from "./runtime-registry.js";

export {
  discoverToolPlugins,
  listToolPlugins,
  getPluginMetadata,
  ensurePluginReady,
} from "./plugin-loader.js";

export type { ListedToolPlugin } from "./plugin-loader.js";

export {
  discoverAgents,
  listAgents,
  readAgentConfig,
  registerOpenBotRootDefaultAgent,
} from "./agent-loader.js";

export type { AgentConfig, ListedAgent } from "./agent-loader.js";
