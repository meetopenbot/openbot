import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ManagerState, ManagerEvent } from "./types.js";

const CONVERSATIONS_DIR = path.join(os.homedir(), ".openbot", "conversations");

function getConversationDir(conversationId: string): string {
  return path.join(CONVERSATIONS_DIR, conversationId);
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

export async function loadConversationState(conversationId: string): Promise<ManagerState | null> {
  const normalizedConversationId = normalizeConversationId(conversationId);
  const conversationDir = getConversationDir(normalizedConversationId);
  const statePath = path.join(conversationDir, "state.json");

  if (!fs.existsSync(statePath)) return null;

  try {
    const data = fs.readFileSync(statePath, "utf-8");
    const state: ManagerState = JSON.parse(data);

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

export async function saveConversationState(conversationId: string, state: ManagerState) {
  const normalizedConversationId = normalizeConversationId(conversationId);
  const conversationDir = getConversationDir(normalizedConversationId);
  if (!fs.existsSync(conversationDir)) {
    fs.mkdirSync(conversationDir, { recursive: true });
  }

  const statePath = path.join(conversationDir, "state.json");
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
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

  const state: ManagerState = { title: slug, conversationId };
  await saveConversationState(conversationId, state);
  return { id: conversationId, title: slug };
}

export async function deleteChannelConversation(conversationId: string): Promise<boolean> {
  const normalizedConversationId = normalizeConversationId(conversationId);
  if (!normalizedConversationId.startsWith("channel_")) return false;

  const conversationDir = getConversationDir(normalizedConversationId);
  if (!fs.existsSync(conversationDir)) return false;

  fs.rmSync(conversationDir, { recursive: true, force: true });
  return true;
}

export async function logConversationEvent(conversationId: string, runId: string, event: ManagerEvent) {
  const normalizedConversationId = normalizeConversationId(conversationId);
  const conversationDir = getConversationDir(normalizedConversationId);
  if (!fs.existsSync(conversationDir)) {
    fs.mkdirSync(conversationDir, { recursive: true });
  }

  const logPath = path.join(conversationDir, "events.jsonl");
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    runId,
    ...event,
  });

  fs.appendFileSync(logPath, entry + "\n", "utf-8");
}

export async function loadConversationEvents(conversationId: string): Promise<ManagerEvent[]> {
  const normalizedConversationId = normalizeConversationId(conversationId);
  const conversationDir = getConversationDir(normalizedConversationId);
  const logPath = path.join(conversationDir, "events.jsonl");

  if (!fs.existsSync(logPath)) return [];

  try {
    const data = fs.readFileSync(logPath, "utf-8");
    return data
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as ManagerEvent);
  } catch (error) {
    console.error(`Failed to load events for conversation ${normalizedConversationId}:`, error);
    return [];
  }
}

export async function listConversations(): Promise<Array<{
  id: string;
  kind: "dm" | "channel";
  title?: string;
  agentId?: string;
  mtime: Date;
}>> {
  const items: Array<{ id: string; kind: "dm" | "channel"; title?: string; agentId?: string; mtime: Date }> = [];

  if (fs.existsSync(CONVERSATIONS_DIR)) {
    try {
      for (const conversationId of fs.readdirSync(CONVERSATIONS_DIR)) {
        const conversationDir = path.join(CONVERSATIONS_DIR, conversationId);
        if (!fs.statSync(conversationDir).isDirectory()) continue;

        const statePath = path.join(conversationDir, "state.json");
        if (!fs.existsSync(statePath)) continue;

        const state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as ManagerState;
        const kind = inferConversationKind(conversationId);
        const channelTitle = kind === "channel"
          ? getChannelSlugFromConversationId(conversationId)
          : undefined;
        items.push({
          id: conversationId,
          kind,
          title: channelTitle ?? state.title ?? undefined,
          agentId: kind === "dm" ? conversationId.slice(3) : undefined,
          mtime: fs.statSync(statePath).mtime,
        });
      }
    } catch (error) {
      console.error("Failed to list conversations:", error);
    }
  }

  return items
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, MAX_LISTED_CONVERSATIONS);
}
