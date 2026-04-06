import { MelonyPlugin } from "melony";
import { z } from "zod";

/**
 * Tool plugin registry entry.
 */
export interface PluginRegistryEntry {
  id: string;
  name: string;
  description: string;
  folder?: string;
  isBuiltIn?: boolean;
}

export interface ToolPluginRegistryEntry extends PluginRegistryEntry {
  plugin: (options?: any) => MelonyPlugin<any, any>;
  toolDefinitions: Record<string, {
    description: string;
    inputSchema: z.ZodType<any>;
  }>;
}

/**
 * Tool Plugin Registry
 *
 * Holds tool plugins only.
 */
export class PluginRegistry {
  private pluginsByName = new Map<string, ToolPluginRegistryEntry>();
  private pluginsById = new Map<string, ToolPluginRegistryEntry>();

  register(entry: ToolPluginRegistryEntry): void {
    if (this.pluginsByName.has(entry.name)) {
      console.warn(`Plugin "${entry.name}" is already registered — overwriting`);
    }
    if (this.pluginsById.has(entry.id)) {
      console.warn(`Plugin id "${entry.id}" is already registered — overwriting`);
    }
    this.pluginsByName.set(entry.name, entry);
    this.pluginsById.set(entry.id, entry);
  }

  get(nameOrId: string): ToolPluginRegistryEntry | undefined {
    return this.pluginsByName.get(nameOrId) ?? this.pluginsById.get(nameOrId);
  }

  has(nameOrId: string): boolean {
    return this.pluginsByName.has(nameOrId) || this.pluginsById.has(nameOrId);
  }

  getAll(): ToolPluginRegistryEntry[] {
    return Array.from(this.pluginsById.values());
  }

  getNames(): string[] {
    return Array.from(this.pluginsByName.keys());
  }
}
