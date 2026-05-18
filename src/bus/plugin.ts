import { MelonyPlugin } from 'melony';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import { AgentDetails, ConfigSchema, Storage } from './types.js';

/**
 * Reference to a plugin from an agent's AGENT.md frontmatter.
 *
 * The `id` is either a built-in plugin id (e.g. `openbot`, `shell`) or an npm
 * package name (e.g. `openbot-plugin-codex`, `@scope/openbot-plugin-foo`).
 * Each entry may carry plugin-specific `config`.
 */
export interface PluginRef {
  id: string;
  config?: Record<string, unknown>;
}

/** Tool definition shape contributed by a plugin and consumed by runtime plugins. */
export interface ToolDefinition {
  description: string;
  inputSchema: unknown;
}

/**
 * Context passed to a Plugin factory at runtime.
 *
 * `tools` is the merged tool map collected from every tool plugin attached to
 * the same agent. Runtime plugins read it to feed an LLM; tool plugins ignore
 * it. The agent loader is responsible for the merge and collision detection.
 */
export interface PluginContext {
  agentId: string;
  agentDetails: AgentDetails;
  config: Record<string, unknown>;
  storage: Storage;
  tools: Record<string, ToolDefinition>;
}

/**
 * A Plugin is the single extension unit on the OpenBot bus.
 *
 * The bus does not care whether a plugin owns the LLM loop (a "runtime"
 * plugin), contributes tools (a "tool" plugin), or layers behaviour (e.g.
 * approval middleware). Roles are defined entirely by which events the plugin
 * subscribes to and emits.
 *
 * - Runtime plugins typically handle `agent:invoke` and may consume `tools`.
 * - Tool plugins typically expose `toolDefinitions` and handle `action:<tool>`.
 * - Middleware plugins observe events and (re-)emit them with extra logic.
 *
 * An agent must include at least one plugin that handles `agent:invoke`; the
 * loader cannot enforce this statically (handlers are registered at factory
 * time), so misconfigured agents will simply not respond.
 */
export interface Plugin {
  id: string;
  name: string;
  description: string;
  image?: string;
  /** JSON-schema-like description of `config` accepted in AGENT.md `plugins[].config`. */
  configSchema?: ConfigSchema;
  /** Tool definitions contributed to any runtime plugin attached to the same agent. */
  toolDefinitions?: Record<string, ToolDefinition>;
  /** Build the Melony plugin that wires this plugin onto the bus for one run. */
  factory: (context: PluginContext) => MelonyPlugin<OpenBotState, OpenBotEvent>;
}
