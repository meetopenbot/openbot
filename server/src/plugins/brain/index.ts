import { MelonyPlugin, RuntimeContext, Event } from "melony";
import { ui } from "@melony/ui-kit/server";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BrainPluginOptions } from "./types.js";
import { createIdentityModule } from "./identity.js";
import { createMemoryModule } from "./memory.js";
import { buildBrainPrompt, BrainModules } from "./prompt.js";
import { statusWidget } from "../../ui/widgets/status.js";

// Re-exports
export { brainToolDefinitions } from "./types.js";
export type { BrainPluginOptions, MemoryEntry } from "./types.js";
export { buildBrainPrompt } from "./prompt.js";
export type { BrainModules } from "./prompt.js";

// --- Helpers ---

export interface BrainStatusEvent extends Event {
  type: "brain:status";
  data: { message: string; severity?: "info" | "success" | "error" };
}

function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(process.env.HOME || "", p.slice(2));
  }
  return p;
}

/**
 * Create a prompt-builder function bound to a baseDir.
 * Returns the brain's portion of the system prompt (identity + memory).
 */
export function createBrainPromptBuilder(baseDir: string) {
  const expandedBase = expandPath(baseDir);

  const modules: BrainModules = {
    identity: createIdentityModule(expandedBase),
    memory: createMemoryModule(expandedBase),
  };

  return async (context?: RuntimeContext) =>
    buildBrainPrompt(expandedBase, modules, context);
}

// --- Plugin ---

/**
 * Brain Plugin for Melony
 *
 * Provides the bot's "brain": identity and long-term memory with recall.
 * Skills are managed by the separate skills plugin.
 *
 * Architecture: thin facade that delegates to focused sub-modules
 * (identity, memory) — each independently testable and replaceable.
 */
export const brainPlugin = (
  options: BrainPluginOptions
): MelonyPlugin<any, any> => (builder) => {
  const { baseDir } = options;
  const expandedBase = expandPath(baseDir);

  // Create sub-modules
  const identity = createIdentityModule(expandedBase);
  const memory = createMemoryModule(expandedBase);

  // ─── Initialization ───────────────────────────────────────────────

  builder.on("init", async function* (_event, context) {
    yield {
      type: "brain:status",
      data: { message: "Initializing brain..." },
    };

    await fs.mkdir(expandedBase, { recursive: true, mode: 0o700 });
    await identity.initialize();
    await memory.initialize();

    yield {
      type: "brain:status",
      data: { message: "Brain initialized", severity: "success" },
    };
  });

  // ─── Memory: Remember ─────────────────────────────────────────────

  builder.on("action:remember", async function* (event) {
    const { content, tags = [], toolCallId } = event.data;

    try {
      const entry = await memory.store(content, tags);

      yield {
        type: "brain:status",
        data: { message: "Remembered", severity: "success" },
      };

      yield {
        type: "action:taskResult",
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
        type: "brain:status",
        data: {
          message: `Failed to remember: ${error.message}`,
          severity: "error",
        },
      };
      yield {
        type: "action:taskResult",
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
        type: "action:taskResult",
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
        type: "action:taskResult",
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
        type: "brain:status",
        data: {
          message: removed ? "Memory removed" : "Memory not found",
          severity: removed ? "success" : "error",
        },
      };

      yield {
        type: "action:taskResult",
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
        type: "action:taskResult",
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
        type: "brain:status",
        data: { message: "Journal entry added", severity: "success" },
      };

      yield {
        type: "action:taskResult",
        data: {
          action: "journal",
          toolCallId,
          result: { success: true, message: "Journal entry added" },
        },
      };
    } catch (error: any) {
      yield {
        type: "brain:status",
        data: {
          message: `Failed to journal: ${error.message}`,
          severity: "error",
        },
      };
      yield {
        type: "action:taskResult",
        data: {
          action: "journal",
          toolCallId,
          result: { error: error.message },
        },
      };
    }
  });

  // ─── Identity: Update ──────────────────────────────────────────────

  builder.on("action:updateIdentity", async function* (event) {
    const { content, toolCallId } = event.data;

    try {
      await identity.updateIdentity(content);

      yield {
        type: "brain:status",
        data: { message: "Identity updated", severity: "success" },
      };

      yield {
        type: "action:taskResult",
        data: {
          action: "updateIdentity",
          toolCallId,
          result: {
            success: true,
            message:
              "Identity updated. Changes will take effect on next initialization.",
          },
        },
      };
    } catch (error: any) {
      yield {
        type: "brain:status",
        data: {
          message: `Failed to update identity: ${error.message}`,
          severity: "error",
        },
      };
      yield {
        type: "action:taskResult",
        data: {
          action: "updateIdentity",
          toolCallId,
          result: { error: error.message },
        },
      };
    }
  });

  // ─── Identity: Read ────────────────────────────────────────────────

  builder.on("action:readIdentity", async function* (event) {
    const { file, toolCallId } = event.data;

    try {
      const content = await identity.readFile(file);

      yield {
        type: "action:taskResult",
        data: {
          action: "readIdentity",
          toolCallId,
          result: { file, content },
        },
      };
    } catch (error: any) {
      yield {
        type: "action:taskResult",
        data: {
          action: "readIdentity",
          toolCallId,
          result: { error: `Could not read ${file}: ${error.message}` },
        },
      };
    }
  });

  builder.on("brain:status" as any, async function* (event: BrainStatusEvent) {
    yield ui.event(statusWidget(event.data.message, event.data.severity));
  });
};

export default brainPlugin;
