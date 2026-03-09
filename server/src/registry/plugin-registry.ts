import { MelonyPlugin } from "melony";
import { z } from "zod";
import type { ManagerState, ManagerEvent } from "../types.js";

/**
 * Unified plugin registry entry.
 *
 * Every extension in OpenBot is a "plugin". The `type` field determines
 * whether it contributes tools ("tool") or acts as a delegatable agent ("agent").
 */
export interface PluginRegistryEntry {
  id: string;
  name: string;
  description: string;
  folder?: string;
  isBuiltIn?: boolean;
}

export interface ToolPluginRegistryEntry extends PluginRegistryEntry {
  type: "tool";
  plugin: (options?: any) => MelonyPlugin<any, any>;
  toolDefinitions: Record<string, {
    description: string;
    inputSchema: z.ZodType<any>;
  }>;
}

export interface AgentPluginRegistryEntry extends PluginRegistryEntry {
  type: "agent";
  plugin: MelonyPlugin<ManagerState, ManagerEvent>;
  capabilities?: Record<string, string>;
  subscribe?: string[];
}

export type AnyPluginRegistryEntry = ToolPluginRegistryEntry | AgentPluginRegistryEntry;

/**
 * Unified Plugin Registry
 *
 * Holds both tool plugins and agent plugins in a single registry.
 * Built-in entries are registered at startup; community plugins
 * are discovered from ~/.openbot/plugins/.
 */
export class PluginRegistry {
  private plugins = new Map<string, AnyPluginRegistryEntry>();

  register(entry: AnyPluginRegistryEntry): void {
    if (this.plugins.has(entry.name)) {
      console.warn(`Plugin "${entry.name}" is already registered — overwriting`);
    }
    this.plugins.set(entry.name, entry);
  }

  get(name: string): AnyPluginRegistryEntry | undefined {
    return this.plugins.get(name);
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  getAll(): AnyPluginRegistryEntry[] {
    return Array.from(this.plugins.values());
  }

  getNames(): string[] {
    return Array.from(this.plugins.keys());
  }

  getAgents(): AgentPluginRegistryEntry[] {
    return this.getAll().filter(p => p.type === "agent");
  }

  getTools(): ToolPluginRegistryEntry[] {
    return this.getAll().filter(p => p.type === "tool");
  }

  /** Returns agent IDs as a tuple suitable for z.enum(). */
  getAgentIds(): [string, ...string[]] {
    const ids = this.getAgents().map(a => a.id);
    if (ids.length === 0) {
      throw new Error("No agents registered — at least one agent is required");
    }
    return ids as [string, ...string[]];
  }
}
