import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MemoryEntry, MemoryIndex } from "./types.js";

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

  /**
   * Simple keyword-based relevance scoring.
   * Splits query into terms (ignoring short words) and counts how many
   * appear in the entry's content + tags. Returns a 0-1 score.
   */
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

  // --- Module ---

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

      // Filter by tags if provided
      if (tags && tags.length > 0) {
        candidates = candidates.filter((entry) =>
          tags.some((tag) => entry.tags.includes(tag))
        );
      }

      // Score and sort by relevance
      const scored = candidates
        .map((entry) => ({ entry, score: scoreMatch(entry, query) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      // If no keyword matches found, fall back to most recent entries
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
      const today = new Date().toISOString().split("T")[0]; // e.g., "2026-02-12"
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
