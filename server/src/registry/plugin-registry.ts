import { MelonyPlugin } from "melony";
import { z } from "zod";

/**
 * Describes a registered plugin that YAML agents can reference by name.
 *
 * Each entry bundles:
 *  - tool definitions (Zod schemas the LLM sees)
 *  - a factory that produces the Melony plugin (event handlers)
 *  - an optional UI factory for status/rendering plugins
 */
export interface PluginRegistryEntry {
  /** Short kebab-case name used in agent.yaml (e.g. "shell", "file-system") */
  name: string;
  /** Human-readable description shown in logs */
  description: string;
  /** Tool schemas exposed to the LLM when this plugin is included */
  toolDefinitions: Record<string, {
    description: string;
    inputSchema: z.ZodType<any>;
  }>;
  /** Creates a fresh plugin instance with event handlers */
  factory: (options?: any) => MelonyPlugin<any, any>;
}

/**
 * Plugin Registry
 *
 * Maps plugin names to their factories and tool definitions.
 * Built-in plugins are registered at startup; community plugins
 * can be added via npm packages or local directories (future).
 */
export class PluginRegistry {
  private plugins = new Map<string, PluginRegistryEntry>();

  register(entry: PluginRegistryEntry): void {
    this.plugins.set(entry.name, entry);
  }

  get(name: string): PluginRegistryEntry | undefined {
    return this.plugins.get(name);
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  getAll(): PluginRegistryEntry[] {
    return Array.from(this.plugins.values());
  }

  getNames(): string[] {
    return Array.from(this.plugins.keys());
  }
}
