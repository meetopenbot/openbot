import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { generateId } from "melony";
import { ConversationState, ConversationEvent } from "../app/types.js";

const CONVERSATIONS_DIR = path.join(os.homedir(), ".openbot", "conversations");
const CHANNELS_DIR = path.join(os.homedir(), ".openbot", "channels");
const PROJECTS_DIR = path.join(os.homedir(), "Documents", "openbot");

function getChannelProjectDir(conversationId: string): string | null {
  if (!conversationId.startsWith("channel_")) return null;
  const slug = slugifyChannelName(conversationId.slice("channel_".length));
  if (!slug) return null;
  return path.join(PROJECTS_DIR, slug);
}

function getConversationDir(conversationId: string): string {
  const kind = inferConversationKind(conversationId);
  return path.join(kind === "channel" ? CHANNELS_DIR : CONVERSATIONS_DIR, conversationId);
}

const MAX_MESSAGES = 1000;
const MAX_LISTED_CONVERSATIONS = 1000;

function inferConversationKind(conversationId: string): "dm" | "channel" {
  return conversationId.startsWith("dm_") ? "dm" : "channel";
}

function slugifyChannelName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeChannelConversationId(conversationId: string): string {
  if (!conversationId.startsWith("channel_")) return conversationId;
  const rawName = conversationId.slice("channel_".length);
  const slug = slugifyChannelName(rawName);
  return slug ? `channel_${slug}` : conversationId;
}

export function normalizeConversationId(conversationId: string): string {
  return normalizeChannelConversationId(conversationId.trim());
}

function getChannelSlugFromConversationId(conversationId: string): string | undefined {
  if (!conversationId.startsWith("channel_")) return undefined;
  const slug = slugifyChannelName(conversationId.slice("channel_".length));
  return slug || undefined;
}

export async function loadConversationState(conversationId: string): Promise<ConversationState | null> {
  const normalizedConversationId = normalizeConversationId(conversationId);
  const conversationDir = getConversationDir(normalizedConversationId);
  const statePath = path.join(conversationDir, "state.json");

  if (!fs.existsSync(statePath)) return null;

  // Ensure SPEC.md exists for channels
  if (normalizedConversationId.startsWith("channel_")) {
    const specPath = path.join(conversationDir, "SPEC.md");
    if (!fs.existsSync(specPath)) {
      const channelTitle = getChannelSlugFromConversationId(normalizedConversationId) || "Channel";
      const initialSpec = `# ${channelTitle}\n\nThis channel is spec-driven. Define the goals and rules for this channel here.`;
      fs.writeFileSync(specPath, initialSpec, "utf-8");
    }
  }

  try {
    const data = fs.readFileSync(statePath, "utf-8");
    const state: ConversationState = JSON.parse(data);

    // If it's a channel, ensure it has a project-specific CWD
    if (normalizedConversationId.startsWith("channel_")) {
      const projectDir = getChannelProjectDir(normalizedConversationId);
      if (projectDir) {
        if (!state.cwd) state.cwd = projectDir;
        if (!state.openbotRoot) state.openbotRoot = process.cwd();

        if (!fs.existsSync(projectDir)) {
          fs.mkdirSync(projectDir, { recursive: true });
        }
      }
    }

    if (state.messages && state.messages.length > MAX_MESSAGES) {
      const systemMessages = [];
      let rest = state.messages;

      while (rest.length > 0 && rest[0].role === "system") {
        systemMessages.push(rest[0]);
        rest = rest.slice(1);
      }

      const kept = rest.slice(-MAX_MESSAGES);
      state.messages = [...systemMessages, ...kept];
    }

    return state;
  } catch (error) {
    console.error(`Failed to load conversation ${normalizedConversationId}:`, error);
    return null;
  }
}

/** Runtime-only fields that must not survive reload (corrupt next runs if persisted). */
function stateForPersistence(state: ConversationState): ConversationState {
  const snapshot = JSON.parse(JSON.stringify(state)) as ConversationState;
  delete snapshot.openBotDelegationToolFeedback;
  delete snapshot.openBotExecutingAgentId;
  if (snapshot.agentStates) {
    for (const key of Object.keys(snapshot.agentStates)) {
      const ag = snapshot.agentStates[key];
      if (ag && typeof ag === "object") {
        delete ag.openBotExecutingAgentId;
        delete ag.openBotDelegationToolFeedback;
      }
    }
  }
  return snapshot;
}

export async function saveConversationState(conversationId: string, state: ConversationState) {
  const normalizedConversationId = normalizeConversationId(conversationId);
  const conversationDir = getConversationDir(normalizedConversationId);
  if (!fs.existsSync(conversationDir)) {
    fs.mkdirSync(conversationDir, { recursive: true });
  }

  const statePath = path.join(conversationDir, "state.json");
  fs.writeFileSync(statePath, JSON.stringify(stateForPersistence(state), null, 2), "utf-8");
}

export async function createChannelConversation(name: string): Promise<{
  id: string;
  title: string;
}> {
  const normalizedTitle = name.trim();
  if (!normalizedTitle) {
    throw new Error("Channel name is required");
  }

  const slug = slugifyChannelName(normalizedTitle);
  if (!slug) {
    throw new Error("Invalid channel name");
  }

  const conversationId = `channel_${slug}`;
  const conversationDir = getConversationDir(conversationId);
  if (fs.existsSync(conversationDir)) {
    throw new Error("Channel already exists");
  }

  const projectDir = getChannelProjectDir(conversationId);
  if (projectDir && !fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  const state: ConversationState = {
    title: slug,
    conversationId,
    cwd: projectDir || undefined,
    openbotRoot: process.cwd(),
  };
  await saveConversationState(conversationId, state);

  // Create initial SPEC.md for the channel
  const specPath = path.join(conversationDir, "SPEC.md");
  const initialSpec = `# ${normalizedTitle}\n\nThis channel is spec-driven. Define the goals and rules for this channel here.`;
  fs.writeFileSync(specPath, initialSpec, "utf-8");

  return { id: conversationId, title: slug };
}

export function getChannelSpecPath(conversationId: string): string | null {
  const normalizedConversationId = normalizeConversationId(conversationId);
  if (!normalizedConversationId.startsWith("channel_")) return null;
  const conversationDir = getConversationDir(normalizedConversationId);
  return path.join(conversationDir, "SPEC.md");
}

export async function loadChannelSpec(conversationId: string): Promise<string | null> {
  const specPath = getChannelSpecPath(conversationId);
  if (!specPath || !fs.existsSync(specPath)) return null;
  return fs.readFileSync(specPath, "utf-8");
}

export async function saveChannelSpec(conversationId: string, content: string) {
  const specPath = getChannelSpecPath(conversationId);
  if (!specPath) throw new Error("Invalid channel ID for spec");
  const conversationDir = path.dirname(specPath);
  if (!fs.existsSync(conversationDir)) {
    fs.mkdirSync(conversationDir, { recursive: true });
  }
  fs.writeFileSync(specPath, content, "utf-8");
}

export async function deleteChannelConversation(conversationId: string): Promise<boolean> {
  const normalizedConversationId = normalizeConversationId(conversationId);
  if (!normalizedConversationId.startsWith("channel_")) return false;

  const conversationDir = getConversationDir(normalizedConversationId);
  if (!fs.existsSync(conversationDir)) return false;

  fs.rmSync(conversationDir, { recursive: true, force: true });
  return true;
}

function normalizeStoredTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function normalizeStoredLogLine(
  raw: Record<string, unknown>,
  lineIndex: number,
): ConversationEvent & { timestamp: number; id: string; runId?: string } {
  const runId = typeof raw.runId === "string" ? raw.runId : "";
  const id =
    typeof raw.id === "string" && raw.id.trim() !== ""
      ? raw.id
      : `evt_${runId || "norun"}_${lineIndex}`;
  return {
    ...raw,
    runId: runId || undefined,
    timestamp: normalizeStoredTimestamp(raw.timestamp),
    id,
  } as ConversationEvent & { timestamp: number; id: string; runId?: string };
}

export async function logConversationEvent(conversationId: string, runId: string, event: ConversationEvent) {
  if (event.type === "agent:output-delta") return;

  const normalizedConversationId = normalizeConversationId(conversationId);
  const conversationDir = getConversationDir(normalizedConversationId);
  if (!fs.existsSync(conversationDir)) {
    fs.mkdirSync(conversationDir, { recursive: true });
  }

  const logPath = path.join(conversationDir, "events.jsonl");
  const incoming = event as ConversationEvent & { timestamp?: unknown; id?: unknown; runId?: unknown };
  const { timestamp: _ts, id: incomingId, runId: _eventRunId, ...eventBody } = incoming;
  const id =
    typeof incomingId === "string" && incomingId.trim() !== ""
      ? incomingId
      : generateId();
  const entry = JSON.stringify({
    ...eventBody,
    runId,
    timestamp: Date.now(),
    id,
  });

  fs.appendFileSync(logPath, entry + "\n", "utf-8");

  // Keep conversation-level activity metadata in state for fast unread checks.
  const state = (await loadConversationState(normalizedConversationId)) ?? {};
  state.conversationId = normalizedConversationId;
  state.lastEventId = id;
  state.lastEventAt = Date.now();
  await saveConversationState(normalizedConversationId, state);
}

export async function loadConversationEvents(conversationId: string): Promise<ConversationEvent[]> {
  const normalizedConversationId = normalizeConversationId(conversationId);
  const conversationDir = getConversationDir(normalizedConversationId);
  const logPath = path.join(conversationDir, "events.jsonl");

  if (!fs.existsSync(logPath)) return [];

  try {
    const data = fs.readFileSync(logPath, "utf-8");
    return data
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line, index) => normalizeStoredLogLine(JSON.parse(line) as Record<string, unknown>, index));
  } catch (error) {
    console.error(`Failed to load events for conversation ${normalizedConversationId}:`, error);
    return [];
  }
}

export async function loadConversationEventsRaw(conversationId: string): Promise<string> {
  const normalizedConversationId = normalizeConversationId(conversationId);
  const conversationDir = getConversationDir(normalizedConversationId);
  const logPath = path.join(conversationDir, "events.jsonl");

  if (!fs.existsSync(logPath)) return "";

  try {
    return fs.readFileSync(logPath, "utf-8");
  } catch (error) {
    console.error(`Failed to load raw events for conversation ${normalizedConversationId}:`, error);
    return "";
  }
}

export async function listConversations(userId = "you"): Promise<Array<{
  id: string;
  kind: "dm" | "channel";
  title?: string;
  agentId?: string;
  mtime: Date;
  lastEventId?: string;
  lastEventAt?: number;
  lastReadAt?: number;
  unread: boolean;
  participatingAgents?: string[];
}>> {
  const items: Array<{
    id: string;
    kind: "dm" | "channel";
    title?: string;
    agentId?: string;
    mtime: Date;
    lastEventId?: string;
    lastEventAt?: number;
    lastReadAt?: number;
    unread: boolean;
    participatingAgents?: string[];
  }> = [];

  const directories = [CONVERSATIONS_DIR, CHANNELS_DIR];
  for (const dir of directories) {
    if (fs.existsSync(dir)) {
      try {
        for (const conversationId of fs.readdirSync(dir)) {
          const conversationDir = path.join(dir, conversationId);
          if (!fs.statSync(conversationDir).isDirectory()) continue;

          const statePath = path.join(conversationDir, "state.json");
          if (!fs.existsSync(statePath)) continue;

          const state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as ConversationState;
          const readState = state.readByUser?.[userId];
          const lastReadAt =
            typeof readState?.lastReadAt === "number" && Number.isFinite(readState.lastReadAt)
              ? readState.lastReadAt
              : undefined;
          const lastEventAt =
            typeof state.lastEventAt === "number" && Number.isFinite(state.lastEventAt)
              ? state.lastEventAt
              : undefined;
          const kind = inferConversationKind(conversationId);
          const channelTitle =
            kind === "channel" ? getChannelSlugFromConversationId(conversationId) : undefined;
          items.push({
            id: conversationId,
            kind,
            title: channelTitle ?? state.title ?? undefined,
            agentId: kind === "dm" ? conversationId.slice(3) : undefined,
            mtime: fs.statSync(statePath).mtime,
            lastEventId: typeof state.lastEventId === "string" ? state.lastEventId : undefined,
            lastEventAt,
            lastReadAt,
            unread: typeof lastEventAt === "number" && (lastReadAt ?? 0) < lastEventAt,
            participatingAgents: Array.isArray(state.participatingAgents)
              ? state.participatingAgents
              : undefined,
          });
        }
      } catch (error) {
        console.error(`Failed to list conversations from ${dir}:`, error);
      }
    }
  }

  return items
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, MAX_LISTED_CONVERSATIONS);
}

export async function markConversationRead(
  conversationId: string,
  userId = "you",
): Promise<ConversationState | null> {
  const normalizedConversationId = normalizeConversationId(conversationId);
  const state = await loadConversationState(normalizedConversationId);
  if (!state) return null;

  const readByUser = state.readByUser ?? {};
  const current = readByUser[userId] ?? {};
  readByUser[userId] = {
    ...current,
    lastReadEventId: state.lastEventId ?? current.lastReadEventId,
    lastReadAt:
      typeof state.lastEventAt === "number" && Number.isFinite(state.lastEventAt)
        ? state.lastEventAt
        : Date.now(),
  };

  state.readByUser = readByUser;
  state.conversationId = normalizedConversationId;
  await saveConversationState(normalizedConversationId, state);
  return state;
}
