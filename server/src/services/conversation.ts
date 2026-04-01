import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { generateId } from "melony";
import { ConversationState, ConversationEvent } from "../app/types.js";

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

export async function loadConversationState(conversationId: string): Promise<ConversationState | null> {
  const normalizedConversationId = normalizeConversationId(conversationId);
  const conversationDir = getConversationDir(normalizedConversationId);
  const statePath = path.join(conversationDir, "state.json");

  if (!fs.existsSync(statePath)) return null;

  try {
    const data = fs.readFileSync(statePath, "utf-8");
    const state: ConversationState = JSON.parse(data);

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

export async function saveConversationState(conversationId: string, state: ConversationState) {
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

  const state: ConversationState = {
    title: slug,
    conversationId,
    channelMembers: [{ id: "you", name: "You" }],
    channelManagerId: "you",
  };
  await saveConversationState(conversationId, state);
  return { id: conversationId, title: slug };
}

export interface ChannelMember {
  id: string;
  name: string;
}

export interface ChannelMembersState {
  conversationId: string;
  managerId: string;
  members: ChannelMember[];
}

function sanitizeMember(input: ChannelMember): ChannelMember {
  return {
    id: input.id.trim().toLowerCase(),
    name: input.name.trim(),
  };
}

function normalizeChannelMembersState(conversationId: string, state: ConversationState): ChannelMembersState {
  const rawMembers = Array.isArray(state.channelMembers) ? state.channelMembers : [];
  const seen = new Set<string>();
  const normalizedMembers: ChannelMember[] = [];

  for (const raw of rawMembers) {
    if (!raw || typeof raw !== "object") continue;
    const id = typeof raw.id === "string" ? raw.id.trim().toLowerCase() : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    normalizedMembers.push({ id, name });
  }

  if (!seen.has("you")) {
    normalizedMembers.unshift({ id: "you", name: "You" });
    seen.add("you");
  }

  const managerIdRaw = typeof state.channelManagerId === "string"
    ? state.channelManagerId.trim().toLowerCase()
    : "";
  const managerId = managerIdRaw && seen.has(managerIdRaw) ? managerIdRaw : "you";

  return {
    conversationId,
    managerId,
    members: normalizedMembers,
  };
}

export async function getChannelMembers(conversationId: string): Promise<ChannelMembersState | null> {
  const normalizedConversationId = normalizeConversationId(conversationId);
  if (!normalizedConversationId.startsWith("channel_")) return null;

  const state = await loadConversationState(normalizedConversationId);
  if (!state) return null;

  const normalized = normalizeChannelMembersState(normalizedConversationId, state);
  state.channelMembers = normalized.members;
  state.channelManagerId = normalized.managerId;
  await saveConversationState(normalizedConversationId, state);
  return normalized;
}

export async function addChannelMember(
  conversationId: string,
  member: ChannelMember,
): Promise<ChannelMembersState | null> {
  const normalizedConversationId = normalizeConversationId(conversationId);
  if (!normalizedConversationId.startsWith("channel_")) return null;

  const state = await loadConversationState(normalizedConversationId);
  if (!state) return null;

  const nextMember = sanitizeMember(member);
  if (!nextMember.id || !nextMember.name) {
    throw new Error("Invalid member");
  }

  const normalized = normalizeChannelMembersState(normalizedConversationId, state);
  if (normalized.members.some((existing) => existing.id === nextMember.id)) {
    throw new Error("Member already exists");
  }

  const next = {
    ...normalized,
    members: [...normalized.members, nextMember],
  };
  state.channelMembers = next.members;
  state.channelManagerId = next.managerId;
  await saveConversationState(normalizedConversationId, state);
  return next;
}

export async function removeChannelMember(
  conversationId: string,
  memberId: string,
): Promise<ChannelMembersState | null> {
  const normalizedConversationId = normalizeConversationId(conversationId);
  if (!normalizedConversationId.startsWith("channel_")) return null;

  const state = await loadConversationState(normalizedConversationId);
  if (!state) return null;

  const normalized = normalizeChannelMembersState(normalizedConversationId, state);
  const normalizedMemberId = memberId.trim().toLowerCase();
  if (!normalizedMemberId || normalizedMemberId === "you") {
    throw new Error("Cannot remove this member");
  }

  if (!normalized.members.some((member) => member.id === normalizedMemberId)) {
    throw new Error("Member not found");
  }

  const members = normalized.members.filter((member) => member.id !== normalizedMemberId);
  const managerId = normalized.managerId === normalizedMemberId ? "you" : normalized.managerId;

  state.channelMembers = members;
  state.channelManagerId = managerId;
  await saveConversationState(normalizedConversationId, state);
  return { conversationId: normalizedConversationId, managerId, members };
}

export async function setChannelManager(
  conversationId: string,
  managerId: string,
): Promise<ChannelMembersState | null> {
  const normalizedConversationId = normalizeConversationId(conversationId);
  if (!normalizedConversationId.startsWith("channel_")) return null;

  const state = await loadConversationState(normalizedConversationId);
  if (!state) return null;

  const normalized = normalizeChannelMembersState(normalizedConversationId, state);
  const normalizedManagerId = managerId.trim().toLowerCase();
  if (!normalizedManagerId) {
    throw new Error("Manager is required");
  }
  if (!normalized.members.some((member) => member.id === normalizedManagerId)) {
    throw new Error("Manager must be an existing member");
  }

  state.channelMembers = normalized.members;
  state.channelManagerId = normalizedManagerId;
  await saveConversationState(normalizedConversationId, state);
  return {
    conversationId: normalizedConversationId,
    managerId: normalizedManagerId,
    members: normalized.members,
  };
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

        const state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as ConversationState;
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
