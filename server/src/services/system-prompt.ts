import * as fs from "node:fs/promises";
import * as path from "node:path";
import { RuntimeContext } from "melony";
import { ConversationState, ConversationEvent } from "../app/types.js";
import { RuntimeRegistry } from "../registry/runtime-registry.js";
import { createMemoryModule, type MemoryModule } from "../plugins/memory.js";
import { loadChannelSpec, loadConversationEvents } from "./conversation.js";

export interface SystemPromptOptions {
  baseDir: string;
  registry: RuntimeRegistry;
}

function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(process.env.HOME || "", p.slice(2));
  }
  return p;
}

const BROADCAST_EVENT_TYPES = new Set([
  "agent:input",
  "agent:output",
  "agent:delegation",
]);

const MAX_ACTIVITY_EVENTS = 30;
const MAX_ENTRY_CHARS = 300;
const MAX_ACTIVITY_TOTAL_CHARS = 4000;

function truncateText(text: string, max: number): string {
  const cleaned = text.replace(/\n+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1) + "…";
}

function formatActivityEntry(event: Record<string, any>): string {
  const type = event.type;
  const data = event.data ?? event;
  const agentId = event.meta?.agentId;
  const content = data?.content ?? "";

  if (type === "agent:input") {
    const sender = agentId ? `user → @${agentId}` : "user";
    return `[${sender}] ${truncateText(content, MAX_ENTRY_CHARS)}`;
  }

  if (type === "agent:output") {
    const agent = agentId || "assistant";
    return `[${agent}] ${truncateText(content, MAX_ENTRY_CHARS)}`;
  }

  if (type === "agent:delegation") {
    const from = agentId || "agent";
    const to = data?.targetAgentId || "agent";
    return `[${from} → @${to}] ${truncateText(content, MAX_ENTRY_CHARS)}`;
  }

  return "";
}

async function buildChannelActivity(conversationId: string): Promise<string> {
  const events = await loadConversationEvents(conversationId);

  const meaningful = events
    .filter((e: any) => BROADCAST_EVENT_TYPES.has(e.type))
    .slice(-MAX_ACTIVITY_EVENTS);

  if (meaningful.length === 0) return "";

  const lines: string[] = [];
  let totalChars = 0;

  for (const event of meaningful) {
    const line = formatActivityEntry(event as Record<string, any>);
    if (!line) continue;
    if (totalChars + line.length > MAX_ACTIVITY_TOTAL_CHARS) break;
    lines.push(line);
    totalChars += line.length;
  }

  if (lines.length === 0) return "";
  return lines.join("\n");
}

/**
 * Creates a reusable system prompt builder.
 *
 * The prompt is assembled from three clean layers:
 *
 *   1. **Agent Identity** — the agent's own instructions (from AGENT.md body)
 *   2. **User Profile**  — shared context about the user (from USER.md)
 *   3. **Conversation**  — channel spec, environment, memories, peer agents
 */
export function createSystemPromptBuilder(options: SystemPromptOptions) {
  const { baseDir, registry } = options;
  const expandedBase = expandPath(baseDir);
  const memory: MemoryModule = createMemoryModule(expandedBase);

  const getAgentList = (excludeId?: string) => {
    return registry.getAgents()
      .filter((a) => a.id !== excludeId)
      .map((a) => {
        const tools = a.capabilities
          ? Object.entries(a.capabilities)
              .map(([name, desc]) => `    - ${name}: ${desc}`)
              .join("\n")
          : "";
        return `<agent id="${a.id}" name="${a.name}">\n  <description>${a.description}</description>${tools ? `\n  <capabilities>\n${tools}\n  </capabilities>` : ""}\n</agent>`;
      })
      .join("\n\n");
  };

  return async (
    context: RuntimeContext,
    agentInstructions: string = "",
  ): Promise<string> => {
    const state = context.state as ConversationState;
    const conversationId = state.conversationId;
    const currentAgentId = (state as any).agentId;
    const parts: string[] = [];

    // ── Layer 1: Agent Identity ──────────────────────────────────────
    if (agentInstructions.trim()) {
      parts.push(agentInstructions.trim());
    }

    // ── Layer 2: User Profile ────────────────────────────────────────
    try {
      const userPath = path.join(expandedBase, "USER.md");
      const userProfile = await fs.readFile(userPath, "utf-8");
      if (userProfile.trim()) {
        parts.push(`<user_profile>\n${userProfile.trim()}\n</user_profile>`);
      }
    } catch {
      // USER.md doesn't exist yet — that's fine
    }

    // ── Layer 3: Conversation Context ────────────────────────────────

    // Channel spec + recent activity (channels only)
    if (conversationId?.startsWith("channel_")) {
      const spec = await loadChannelSpec(conversationId);
      if (spec) {
        parts.push(`<channel_spec>\n${spec}\n</channel_spec>`);
      }

      const activity = await buildChannelActivity(conversationId);
      if (activity) {
        parts.push(`<channel_activity>\nRecent activity in this channel:\n\n${activity}\n</channel_activity>`);
      }
    }

    // Environment
    const currentCwd = state?.cwd || process.cwd();
    const now = new Date();
    parts.push(
      `<environment>\n- Time: ${now.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})\n- Working Directory: ${currentCwd}\n- OpenBot Home: ${expandedBase}\n</environment>`,
    );

    // TODO: temporarily disabling recent memories as it doesnt give any benefits, opposite - it confuses the model with noise.
    // Recent memories
    // const recentFacts = await memory.getRecentFacts(5);
    // if (recentFacts.length > 0) {
    //   const factsList = recentFacts
    //     .map(
    //       (f) =>
    //         `- ${f.content}${f.tags.length > 0 ? ` [${f.tags.join(", ")}]` : ""}`,
    //     )
    //     .join("\n");
    //   parts.push(`<context>\n${factsList}\n</context>`);
    // }

    // Peer agents
    const agentDescriptions = getAgentList(currentAgentId);
    if (agentDescriptions) {
      parts.push(`<agents>\n${agentDescriptions}\n</agents>`);
    }

    // Session state (custom keys only)
    const reservedKeys = new Set([
      "messages",
      "usage",
      "cwd",
      "openbotRoot",
      "title",
      "conversationId",
      "lastEventId",
      "lastEventAt",
      "readByUser",
      "participatingAgents",
      "agentId",
    ]);
    const customState: Record<string, any> = {};
    for (const key of Object.keys(state)) {
      if (!reservedKeys.has(key)) customState[key] = (state as any)[key];
    }
    if (Object.keys(customState).length > 0) {
      parts.push(
        `<session_state>\n${JSON.stringify(customState, null, 2)}\n</session_state>`,
      );
    }

    // ── Guidelines ───────────────────────────────────────────────────
    const isChannel = conversationId?.startsWith("channel_");
    parts.push(`<guidelines>
You are interacting directly with the user. Focus on solving their request using your tools.
You can collaborate with other agents using the "delegate" tool to delegate tasks or ask questions.
When delegating multiple steps, do them strictly in order: one delegate call, wait for its result, then the next.${isChannel ? `
When working in a channel, review <channel_activity> to understand what other agents have already done. Build on their work instead of repeating it. Reference the <channel_spec> for the shared goals.` : ""}
Use memory tools to manage persistent knowledge about the user and workspace:
- \`remember(content, tags)\`: Store important facts, preferences, or context
- \`recall(query, tags)\`: Search long-term memory before answering questions that might relate to past interactions
- \`forget(memoryId)\`: Remove outdated information
- \`journal(content)\`: Record session reflections
</guidelines>`);

    return parts.join("\n\n");
  };
}
