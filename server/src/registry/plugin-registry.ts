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
  private plugins = new Map<string, ToolPluginRegistryEntry>();

  register(entry: ToolPluginRegistryEntry): void {
    if (this.plugins.has(entry.name)) {
      console.warn(`Plugin "${entry.name}" is already registered — overwriting`);
    }
    this.plugins.set(entry.name, entry);
  }

  get(name: string): ToolPluginRegistryEntry | undefined {
    return this.plugins.get(name);
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  getAll(): ToolPluginRegistryEntry[] {
    return Array.from(this.plugins.values());
  }

  getNames(): string[] {
    return Array.from(this.plugins.keys());
  }
}
