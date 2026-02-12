import { MelonyPlugin } from "melony";
import { ChatState, ChatEvent } from "../types.js";

/**
 * Describes a registered agent — built-in or discovered from YAML.
 */
export interface AgentRegistryEntry {
  /** Unique agent name used for delegation (e.g. "os", "browser", "devops") */
  name: string;
  /** Human-readable description — included in the delegateTask tool so the LLM knows when to use this agent */
  description: string;
  /** The composed Melony plugin that powers this agent */
  plugin: MelonyPlugin<ChatState, ChatEvent>;
}

/**
 * Agent Registry
 *
 * Collects all available agents (built-in + discovered).
 * Used by the manager to dynamically build the delegation tool schema
 * and wire up generic bridge-back handlers.
 */
export class AgentRegistry {
  private agents = new Map<string, AgentRegistryEntry>();

  register(entry: AgentRegistryEntry): void {
    if (this.agents.has(entry.name)) {
      console.warn(`Agent "${entry.name}" is already registered — overwriting`);
    }
    this.agents.set(entry.name, entry);
  }

  get(name: string): AgentRegistryEntry | undefined {
    return this.agents.get(name);
  }

  has(name: string): boolean {
    return this.agents.has(name);
  }

  getAll(): AgentRegistryEntry[] {
    return Array.from(this.agents.values());
  }

  /** Returns agent names as a tuple suitable for z.enum() */
  getNames(): [string, ...string[]] {
    const names = Array.from(this.agents.keys());
    if (names.length === 0) {
      throw new Error("No agents registered — at least one agent is required");
    }
    return names as [string, ...string[]];
  }
}
