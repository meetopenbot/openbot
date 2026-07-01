import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getBaseDir } from '../../app/config.js';

/**
 * Global memory service.
 *
 * Persistent, agent-shared knowledge store that lives outside of any single
 * channel/thread conversation. Designed as a stable foundation we can extend
 * later with embeddings, retrieval ranking, TTLs, etc.
 *
 * Storage format
 * --------------
 * `~/.openbot/memory/log.jsonl` — append-only log. Each line is one of:
 *
 *   { "op": "add", "record": MemoryRecord }
 *   { "op": "delete", "id": string, "at": ISO }
 *   { "op": "update", "id": string, "patch": Partial<MemoryRecord>, "at": ISO }
 *
 * Reads replay the log into an in-memory map. The log is append-only so
 * concurrent writers are line-atomic on every POSIX filesystem we target.
 *
 * Scopes
 * ------
 * `global`            — visible to every agent everywhere.
 * `agent:<agentId>`   — visible only when that agent is running.
 * `channel:<channelId>` — visible only inside that channel.
 *
 * Scope strings are opaque to the store; new scopes can be introduced without
 * a migration.
 */
export interface MemoryRecord {
  id: string;
  scope: string;
  content: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ListMemoriesArgs {
  /** Exact scope match (e.g. `global`, `agent:foo`, `channel:bar`). */
  scope?: string;
  /** Multiple scopes — OR'd together. Useful for "global + agent:X + channel:Y". */
  scopes?: string[];
  /** Substring match (case-insensitive) against `content`. */
  query?: string;
  /** Match if any of these tags is present. */
  tag?: string;
  /** Default 50, hard cap 500. */
  limit?: number;
}

interface AddEntry { op: 'add'; record: MemoryRecord }
interface DeleteEntry { op: 'delete'; id: string; at: string }
interface UpdateEntry { op: 'update'; id: string; patch: Partial<MemoryRecord>; at: string }
type LogEntry = AddEntry | DeleteEntry | UpdateEntry;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const getMemoryDir = (): string => path.join(getBaseDir(), 'memory');

const getLogPath = (): string => path.join(getMemoryDir(), 'log.jsonl');

const ensureDir = async (): Promise<void> => {
  await fs.mkdir(getMemoryDir(), { recursive: true });
};

const readLog = async (): Promise<LogEntry[]> => {
  try {
    const raw = await fs.readFile(getLogPath(), 'utf-8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as LogEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is LogEntry => !!e);
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === 'ENOENT') return [];
    throw e;
  }
};

const replay = (entries: LogEntry[]): Map<string, MemoryRecord> => {
  const out = new Map<string, MemoryRecord>();
  for (const entry of entries) {
    if (entry.op === 'add') {
      out.set(entry.record.id, entry.record);
    } else if (entry.op === 'delete') {
      out.delete(entry.id);
    } else if (entry.op === 'update') {
      const existing = out.get(entry.id);
      if (!existing) continue;
      out.set(entry.id, {
        ...existing,
        ...entry.patch,
        id: existing.id,
        updatedAt: entry.at,
      });
    }
  }
  return out;
};

const appendEntry = async (entry: LogEntry): Promise<void> => {
  await ensureDir();
  await fs.appendFile(getLogPath(), `${JSON.stringify(entry)}\n`, 'utf-8');
};

const matchesQuery = (record: MemoryRecord, query?: string, tag?: string): boolean => {
  if (tag) {
    if (!record.tags || !record.tags.includes(tag)) return false;
  }
  if (query) {
    const q = query.toLowerCase();
    if (!record.content.toLowerCase().includes(q)) return false;
  }
  return true;
};

export const memoryService = {
  appendMemory: async (args: {
    scope: string;
    content: string;
    tags?: string[];
  }): Promise<MemoryRecord> => {
    const now = new Date().toISOString();
    const record: MemoryRecord = {
      id: crypto.randomUUID(),
      scope: args.scope,
      content: args.content,
      tags: args.tags?.length ? args.tags : undefined,
      createdAt: now,
      updatedAt: now,
    };
    await appendEntry({ op: 'add', record });
    return record;
  },

  updateMemory: async (args: {
    id: string;
    content?: string;
    tags?: string[];
  }): Promise<boolean> => {
    const entries = await readLog();
    const map = replay(entries);
    if (!map.has(args.id)) return false;
    const at = new Date().toISOString();
    const patch: Partial<MemoryRecord> = {};
    if (args.content !== undefined) patch.content = args.content;
    if (args.tags !== undefined) patch.tags = args.tags.length ? args.tags : undefined;
    if (Object.keys(patch).length === 0) return true;
    await appendEntry({ op: 'update', id: args.id, patch, at });
    return true;
  },

  deleteMemory: async (args: { id: string }): Promise<boolean> => {
    const entries = await readLog();
    const map = replay(entries);
    if (!map.has(args.id)) return false;
    await appendEntry({ op: 'delete', id: args.id, at: new Date().toISOString() });
    return true;
  },

  listMemories: async (args: ListMemoriesArgs = {}): Promise<MemoryRecord[]> => {
    const entries = await readLog();
    const map = replay(entries);
    const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    const scopeSet = (() => {
      if (args.scope) return new Set([args.scope]);
      if (args.scopes && args.scopes.length > 0) return new Set(args.scopes);
      return null;
    })();

    const filtered: MemoryRecord[] = [];
    for (const record of map.values()) {
      if (scopeSet && !scopeSet.has(record.scope)) continue;
      if (!matchesQuery(record, args.query, args.tag)) continue;
      filtered.push(record);
    }

    filtered.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return filtered.slice(0, limit);
  },

  /**
   * Compact the log into a single `add` per surviving record. Cheap to call
   * occasionally; not required for correctness.
   */
  compact: async (): Promise<number> => {
    const entries = await readLog();
    const map = replay(entries);
    const surviving = Array.from(map.values());
    await ensureDir();
    const tmp = `${getLogPath()}.tmp`;
    const body = surviving.map((record) => JSON.stringify({ op: 'add', record })).join('\n');
    await fs.writeFile(tmp, body ? `${body}\n` : '', 'utf-8');
    await fs.rename(tmp, getLogPath());
    return surviving.length;
  },
};
