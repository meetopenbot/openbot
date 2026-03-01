import { MelonyPlugin, RuntimeContext, Event } from "melony";
import { ui } from "@melony/ui-kit/server";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MemoryPluginOptions } from "./types.js";
import { createMemoryModule } from "./memory.js";
import { buildMemoryPrompt, MemoryModules } from "./prompt.js";
import { statusWidget } from "../../ui/widgets/status.js";

// Re-exports
export { memoryToolDefinitions } from "./types.js";
export type { MemoryPluginOptions, MemoryEntry } from "./types.js";
export { buildMemoryPrompt } from "./prompt.js";
export type { MemoryModules } from "./prompt.js";

// --- Helpers ---

export interface MemoryStatusEvent extends Event {
  type: "memory:status";
  data: { message: string; severity?: "info" | "success" | "error" };
}

function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(process.env.HOME || "", p.slice(2));
  }
  return p;
}

const DEFAULT_AGENT_MD = `# Agent Profile

You are the Manager Agent, the central orchestrator of this AI system.
Your role is to analyze user intent, manage long-term memory, and coordinate specialized agents to solve complex tasks.

## Persona
- Professional yet approachable
- Highly organized and efficient
- Focused on providing clear, actionable results
`;

/**
 * Create a prompt-builder function bound to a baseDir.
 * Returns the memory's portion of the system prompt (agent definition + memory).
 */
export function createMemoryPromptBuilder(baseDir: string) {
  const expandedBase = expandPath(baseDir);

  const modules: MemoryModules = {
    memory: createMemoryModule(expandedBase),
  };

  return async (context?: RuntimeContext) =>
    buildMemoryPrompt(expandedBase, modules, context);
}

// --- Plugin ---

/**
 * Memory Plugin for Melony
 *
 * Provides the bot's "memory": agent definition and long-term memory with recall.
 * Skills are managed by the separate skills plugin.
 */
export const memoryPlugin = (
  options: MemoryPluginOptions
): MelonyPlugin<any, any> => (builder) => {
  const { baseDir } = options;
  const expandedBase = expandPath(baseDir);

  // Create sub-modules
  const memory = createMemoryModule(expandedBase);

  // ─── Initialization ───────────────────────────────────────────────

  builder.on("init", async function* (_event, _context) {
    yield {
      type: "memory:status",
      data: { message: "Initializing memory..." },
    };

    await fs.mkdir(expandedBase, { recursive: true, mode: 0o700 });
    
    // Initialize AGENT.md if it doesn't exist
    const agentPath = path.join(expandedBase, "AGENT.md");
    try {
      await fs.access(agentPath);
    } catch {
      await fs.writeFile(agentPath, DEFAULT_AGENT_MD, "utf-8");
    }

    await memory.initialize();

    yield {
      type: "memory:status",
      data: { message: "Memory initialized", severity: "success" },
    };
  });

  // ─── Memory: Remember ─────────────────────────────────────────────

  builder.on("action:remember", async function* (event) {
    const { content, tags = [], toolCallId } = event.data;

    try {
      const entry = await memory.store(content, tags);

      yield {
        type: "memory:status",
        data: { message: "Remembered", severity: "success" },
      };

      yield {
        type: "action:result",
        data: {
          action: "remember",
          toolCallId,
          result: {
            success: true,
            memoryId: entry.id,
            message: `Stored in memory with id ${entry.id}`,
          },
        },
      };
    } catch (error: any) {
      yield {
        type: "memory:status",
        data: {
          message: `Failed to remember: ${error.message}`,
          severity: "error",
        },
      };
      yield {
        type: "action:result",
        data: {
          action: "remember",
          toolCallId,
          result: { error: error.message },
        },
      };
    }
  });

  // ─── Memory: Recall ────────────────────────────────────────────────

  builder.on("action:recall", async function* (event) {
    const { query, tags, limit, toolCallId } = event.data;

    try {
      const results = await memory.recall(query, { tags, limit });

      yield {
        type: "action:result",
        data: {
          action: "recall",
          toolCallId,
          result: {
            count: results.length,
            memories: results.map((e) => ({
              id: e.id,
              content: e.content,
              tags: e.tags,
              createdAt: e.createdAt,
            })),
          },
        },
      };
    } catch (error: any) {
      yield {
        type: "action:result",
        data: {
          action: "recall",
          toolCallId,
          result: { error: error.message },
        },
      };
    }
  });

  // ─── Memory: Forget ────────────────────────────────────────────────

  builder.on("action:forget", async function* (event) {
    const { memoryId, toolCallId } = event.data;

    try {
      const removed = await memory.forget(memoryId);

      yield {
        type: "memory:status",
        data: {
          message: removed ? "Memory removed" : "Memory not found",
          severity: removed ? "success" : "error",
        },
      };

      yield {
        type: "action:result",
        data: {
          action: "forget",
          toolCallId,
          result: {
            success: removed,
            message: removed
              ? "Memory removed"
              : `Memory "${memoryId}" not found`,
          },
        },
      };
    } catch (error: any) {
      yield {
        type: "action:result",
        data: {
          action: "forget",
          toolCallId,
          result: { error: error.message },
        },
      };
    }
  });

  // ─── Memory: Journal ───────────────────────────────────────────────

  builder.on("action:journal", async function* (event) {
    const { content, toolCallId } = event.data;

    try {
      await memory.addJournalEntry(content);

      yield {
        type: "memory:status",
        data: { message: "Journal entry added", severity: "success" },
      };

      yield {
        type: "action:result",
        data: {
          action: "journal",
          toolCallId,
          result: { success: true, message: "Journal entry added" },
        },
      };
    } catch (error: any) {
      yield {
        type: "memory:status",
        data: {
          message: `Failed to journal: ${error.message}`,
          severity: "error",
        },
      };
      yield {
        type: "action:result",
        data: {
          action: "journal",
          toolCallId,
          result: { error: error.message },
        },
      };
    }
  });

  builder.on("memory:status" as any, async function* (event: MemoryStatusEvent) {
    yield ui.event(statusWidget(event.data.message, event.data.severity));
  });
};

export default memoryPlugin;
