import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ChatState, ChatEvent } from "./types.js";

const SESSIONS_DIR = path.join(os.homedir(), ".openbot", "sessions");

function getSessionDir(sessionId: string): string {
  if (!fs.existsSync(SESSIONS_DIR)) {
    const today = new Date().toISOString().slice(0, 10);
    return path.join(SESSIONS_DIR, today, sessionId);
  }

  // 1. Check if it already exists in a date-based folder (YYYY-MM-DD or YYYY-MM)
  const dateFolders = fs.readdirSync(SESSIONS_DIR).filter(d => /^\d{4}-\d{2}(-\d{2})?$/.test(d));
  for (const folder of dateFolders) {
    const dir = path.join(SESSIONS_DIR, folder, sessionId);
    if (fs.existsSync(dir)) {
      return dir;
    }
  }

  // 2. Check if it exists in the root (legacy)
  const legacyDir = path.join(SESSIONS_DIR, sessionId);
  if (fs.existsSync(legacyDir) && fs.statSync(legacyDir).isDirectory()) {
    const stats = fs.statSync(legacyDir);
    const day = stats.mtime.toISOString().slice(0, 10);
    const newDir = path.join(SESSIONS_DIR, day, sessionId);
    
    fs.mkdirSync(path.dirname(newDir), { recursive: true });
    try {
      fs.renameSync(legacyDir, newDir);
      return newDir;
    } catch (error) {
      console.warn(`Failed to migrate session ${sessionId} to ${day}:`, error);
      return legacyDir;
    }
  }

  // 3. New session - use current day
  const today = new Date().toISOString().slice(0, 10);
  return path.join(SESSIONS_DIR, today, sessionId);
}

/**
 * Maximum number of messages to keep when loading a session.
 * Older messages are dropped to avoid bloated context windows.
 * System messages at the start are always preserved and don't count toward the limit.
 */
const MAX_MESSAGES = 1000; // aiSdkPlugin defaults to latest 20 messages

export async function loadSession(sessionId: string): Promise<ChatState | null> {
  const sessionDir = getSessionDir(sessionId);
  const statePath = path.join(sessionDir, "state.json");

  if (!fs.existsSync(statePath)) {
    return null;
  }

  try {
    const data = fs.readFileSync(statePath, "utf-8");
    const state: ChatState = JSON.parse(data);

    if (state.messages && state.messages.length > MAX_MESSAGES) {
      // Preserve system messages at the beginning, then keep the tail
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
    console.error(`Failed to load session ${sessionId}:`, error);
    return null;
  }
}

export async function saveSession(sessionId: string, state: ChatState) {
  const sessionDir = getSessionDir(sessionId);
  
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const statePath = path.join(sessionDir, "state.json");
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export async function logEvent(sessionId: string, runId: string, event: ChatEvent) {
  const sessionDir = getSessionDir(sessionId);
  
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  
  const logPath = path.join(sessionDir, `events.jsonl`);

  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    runId,
    ...event,
  });

  fs.appendFileSync(logPath, entry + "\n", "utf-8");
}

export async function loadEvents(sessionId: string): Promise<ChatEvent[]> {
  const sessionDir = getSessionDir(sessionId);
  const logPath = path.join(sessionDir, `events.jsonl`);

  if (!fs.existsSync(logPath)) {
    return [];
  }

  try {
    const data = fs.readFileSync(logPath, "utf-8");
    return data
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as ChatEvent);
  } catch (error) {
    console.error(`Failed to load events for session ${sessionId}:`, error);
    return [];
  }
}

export async function listSessions(): Promise<{ id: string; mtime: Date }[]> {
  if (!fs.existsSync(SESSIONS_DIR)) return [];

  const sessions: { id: string; mtime: Date }[] = [];

  try {
    const items = fs.readdirSync(SESSIONS_DIR);

    for (const item of items) {
      const itemPath = path.join(SESSIONS_DIR, item);
      const stat = fs.statSync(itemPath);

      if (stat.isDirectory()) {
        // If it's a date folder (YYYY-MM-DD), look inside
        if (/^\d{4}-\d{2}-\d{2}$/.test(item)) {
          const subItems = fs.readdirSync(itemPath);
          for (const subItem of subItems) {
            const sessionPath = path.join(itemPath, subItem);
            const statePath = path.join(sessionPath, "state.json");
            if (fs.existsSync(statePath)) {
              sessions.push({
                id: subItem,
                mtime: fs.statSync(statePath).birthtime, // sort by creation time
              });
            }
          }
        } else {
          // It's a legacy session folder in root
          const statePath = path.join(itemPath, "state.json");
          if (fs.existsSync(statePath)) {
            sessions.push({
              id: item,
              mtime: fs.statSync(statePath).birthtime, // sort by creation time
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("Failed to list sessions:", error);
  }

  return sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}
