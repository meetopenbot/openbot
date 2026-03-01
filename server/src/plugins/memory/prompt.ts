import { RuntimeContext } from "melony";
import { MemoryModule } from "./memory.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// --- Types ---

export interface MemoryModules {
  memory: MemoryModule;
}

// --- Prompt Builder ---

/**
 * Build the memory's section of the system prompt.
 *
 * Includes only what the memory owns:
 * - Environment context
 * - Agent definition (from AGENT.md)
 * - A handful of the most recent memories
 * - Memory capability instructions
 *
 * Skills are handled by the separate skills plugin and composed
 * at the top level in open-bot.ts.
 */
export async function buildMemoryPrompt(
  baseDir: string,
  modules: MemoryModules,
  context?: RuntimeContext
): Promise<string> {
  const parts: string[] = [];

  const state = context?.state as any;
  const currentCwd = state?.cwd || process.cwd();

  // 1. Environment context
  const now = new Date();
  parts.push(`<environment>
- Time: ${now.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})
- CWD: ${currentCwd}
- Bot Home: ${baseDir}
</environment>`);

  // 2. Agent definition (manual edit only)
  try {
    const agentPath = path.join(baseDir, "AGENT.md");
    const agentMd = await fs.readFile(agentPath, "utf-8");
    if (agentMd.trim()) {
      parts.push(`<agent_definition>\n${agentMd.trim()}\n</agent_definition>`);
    }
  } catch {
    // Skip if AGENT.md doesn't exist yet
  }

  // 3. Recent memories (lean — just a few to keep context fresh)
  const recentFacts = await modules.memory.getRecentFacts(5);
  if (recentFacts.length > 0) {
    const factsList = recentFacts
      .map(
        (f) =>
          `- ${f.content}${f.tags.length > 0 ? ` [${f.tags.join(", ")}]` : ""}`
      )
      .join("\n");
    parts.push(`<recent_memories>\n${factsList}\n</recent_memories>`);
  }

  // 4. Memory capabilities
  parts.push(`<memory_tools>
Use these to manage your persistent state:
- \`remember(content, tags)\`: Store facts/preferences
- \`recall(query, tags)\`: Search long-term memory
- \`forget(memoryId)\`: Remove outdated info
- \`journal(content)\`: Record session reflections
</memory_tools>`);

  return `\n${parts.join("\n\n")}\n`;
}
