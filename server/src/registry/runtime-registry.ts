import { MelonyPlugin } from "melony";
import type { ConversationState, ConversationEvent } from "../app/types.js";
import { PluginRegistry, ToolPluginRegistryEntry } from "./plugin-registry.js";

export interface AgentRegistryEntry {
  id: string;
  name: string;
  description: string;
  folder?: string;
  isBuiltIn?: boolean;
  plugin: MelonyPlugin<ConversationState, ConversationEvent>;
  capabilities?: Record<string, string>;
  subscribe?: string[];
}

export class RuntimeRegistry {
  private readonly tools = new PluginRegistry();
  private readonly agents = new Map<string, AgentRegistryEntry>();

  registerTool(entry: ToolPluginRegistryEntry): void {
    this.tools.register(entry);
  }

  registerAgent(entry: AgentRegistryEntry): void {
    if (this.agents.has(entry.name)) {
      console.warn(`Agent "${entry.name}" is already registered — overwriting`);
    }
    this.agents.set(entry.name, entry);
  }

  get(name: string): ToolPluginRegistryEntry | AgentRegistryEntry | undefined {
    return this.tools.get(name) ?? this.agents.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name) || this.agents.has(name);
  }

  getTools(): ToolPluginRegistryEntry[] {
    return this.tools.getAll();
  }

  getAgents(): AgentRegistryEntry[] {
    return Array.from(this.agents.values());
  }

  getNames(): string[] {
    return [...this.tools.getNames(), ...Array.from(this.agents.keys())];
  }

  getAgentIds(): [string, ...string[]] {
    const ids = this.getAgents().map((a) => a.id);
    if (ids.length === 0) {
      throw new Error("No agents registered — at least one agent is required");
    }
    return ids as [string, ...string[]];
  }
}
