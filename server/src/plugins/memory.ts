import { MelonyPlugin } from "melony";
import { uiEvent } from "../ui/block.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { statusWidget } from "../ui/status.js";
import { DEFAULT_USER_MD } from "../app/config.js";

// --- Types ---

export interface MemoryPluginOptions {
  baseDir: string;
}

export interface MemoryEntry {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
}

export interface MemoryIndex {
  entries: MemoryEntry[];
}

export interface MemoryStatusEvent {
  type: "memory:status";
  data: { message: string; severity?: "info" | "success" | "error" };
}

// --- Tool Definitions ---

export const memoryToolDefinitions = {
  remember: {
    description:
      "Store something important in long-term memory. Use for user preferences, learned facts, project context, etc.",
    inputSchema: z.object({
      content: z
        .string()
        .describe("The information to remember"),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          "Tags for categorization (e.g., 'user-preference', 'project', 'learning')"
        ),
    }),
  },
  recall: {
    description:
      "Search your memory for relevant information. Use before answering questions that might relate to past interactions.",
    inputSchema: z.object({
      query: z.string().describe("What to search for in memory"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter by specific tags"),
      limit: z
        .number()
        .optional()
        .describe("Max results to return (default: 5)"),
    }),
  },
  forget: {
    description: "Remove a specific memory entry by ID.",
    inputSchema: z.object({
      memoryId: z
        .string()
        .describe("The ID of the memory entry to remove"),
    }),
  },
  journal: {
    description:
      "Add a journal entry for today. Use for session notes, learnings, and reflections.",
    inputSchema: z.object({
      content: z.string().describe("Journal entry content"),
    }),
  },
};

// --- Module Interface ---

export interface MemoryModule {
  initialize(): Promise<void>;
  store(content: string, tags?: string[]): Promise<MemoryEntry>;
  recall(
    query: string,
    options?: { tags?: string[]; limit?: number }
  ): Promise<MemoryEntry[]>;
  forget(memoryId: string): Promise<boolean>;
  addJournalEntry(content: string): Promise<void>;
  getRecentFacts(limit?: number): Promise<MemoryEntry[]>;
}

// --- Factory ---

export function createMemoryModule(baseDir: string): MemoryModule {
  const memoryDir = path.join(baseDir, "memory");
  const indexPath = path.join(memoryDir, "index.json");
  const journalDir = path.join(memoryDir, "journal");

  // --- Helpers ---

  async function loadIndex(): Promise<MemoryIndex> {
    try {
      const data = await fs.readFile(indexPath, "utf-8");
      return JSON.parse(data);
    } catch {
      return { entries: [] };
    }
  }

  async function saveIndex(index: MemoryIndex): Promise<void> {
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
  }

  function generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    return `mem_${timestamp}_${random}`;
  }

  function scoreMatch(entry: MemoryEntry, query: string): number {
    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);
    if (queryTerms.length === 0) return 0;

    const searchable = `${entry.content} ${entry.tags.join(" ")}`.toLowerCase();

    let matched = 0;
    for (const term of queryTerms) {
      if (searchable.includes(term)) {
        matched++;
      }
    }

    return matched / queryTerms.length;
  }

  return {
    async initialize() {
      await fs.mkdir(memoryDir, { recursive: true });
      await fs.mkdir(journalDir, { recursive: true });

      try {
        await fs.access(indexPath);
      } catch {
        await saveIndex({ entries: [] });
      }
    },

    async store(content: string, tags: string[] = []): Promise<MemoryEntry> {
      const index = await loadIndex();

      const entry: MemoryEntry = {
        id: generateId(),
        content,
        tags,
        createdAt: new Date().toISOString(),
      };

      index.entries.push(entry);
      await saveIndex(index);

      return entry;
    },

    async recall(
      query: string,
      options?: { tags?: string[]; limit?: number }
    ): Promise<MemoryEntry[]> {
      const { tags, limit = 5 } = options || {};
      const index = await loadIndex();

      let candidates = index.entries;

      if (tags && tags.length > 0) {
        candidates = candidates.filter((entry) =>
          tags.some((tag) => entry.tags.includes(tag))
        );
      }

      const scored = candidates
        .map((entry) => ({ entry, score: scoreMatch(entry, query) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      if (scored.length === 0) {
        return candidates.slice(-limit).reverse();
      }

      return scored.map(({ entry }) => entry);
    },

    async forget(memoryId: string): Promise<boolean> {
      const index = await loadIndex();
      const before = index.entries.length;
      index.entries = index.entries.filter((e) => e.id !== memoryId);

      if (index.entries.length < before) {
        await saveIndex(index);
        return true;
      }

      return false;
    },

    async addJournalEntry(content: string): Promise<void> {
      const today = new Date().toISOString().split("T")[0];
      const journalPath = path.join(journalDir, `${today}.md`);
      const timestamp = new Date().toLocaleTimeString();
      const entry = `\n## ${timestamp}\n${content}\n`;

      await fs.mkdir(journalDir, { recursive: true });

      try {
        await fs.access(journalPath);
        await fs.appendFile(journalPath, entry, "utf-8");
      } catch {
        const header = `# Journal - ${today}\n`;
        await fs.writeFile(journalPath, header + entry, "utf-8");
      }
    },

    async getRecentFacts(limit: number = 3): Promise<MemoryEntry[]> {
      const index = await loadIndex();
      return (index?.entries ?? []).slice(-limit);
    },
  };
}

// --- Helpers ---

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

// --- Plugin ---

export const memoryPlugin = (
  options: MemoryPluginOptions
): MelonyPlugin<any, any> => (builder) => {
  const { baseDir } = options;
  const expandedBase = expandPath(baseDir);
  const memory = createMemoryModule(expandedBase);

  builder.on("init", async function* (_event, _context) {
    yield {
      type: "memory:status",
      data: { message: "Initializing memory..." },
    };

    await fs.mkdir(expandedBase, { recursive: true, mode: 0o700 });
    
    // ensure AGENT.md exists
    const agentPath = path.join(expandedBase, "AGENT.md");
    try {
      await fs.access(agentPath);
    } catch {
      await fs.writeFile(agentPath, DEFAULT_AGENT_MD, "utf-8");
    }

    // ensure USER.md exists
    const userPath = path.join(expandedBase, "USER.md");
    try {
      await fs.access(userPath);
    } catch {
      await fs.writeFile(userPath, DEFAULT_USER_MD, "utf-8");
    }

    await memory.initialize();

    yield {
      type: "memory:status",
      data: { message: "Memory initialized", severity: "success" },
    };
  });

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
    yield uiEvent(statusWidget(event.data.message, event.data.severity));
  });
};

export default memoryPlugin;
