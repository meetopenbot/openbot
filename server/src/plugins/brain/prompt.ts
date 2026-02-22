import { RuntimeContext } from "melony";
import { IdentityModule } from "./identity.js";
import { MemoryModule } from "./memory.js";

// --- Types ---

export interface BrainModules {
  identity: IdentityModule;
  memory: MemoryModule;
}

// --- Prompt Builder ---

/**
 * Build the brain's section of the system prompt.
 *
 * Includes only what the brain owns:
 * - Environment context
 * - Identity + Soul (small, static)
 * - A handful of the most recent memories
 * - Brain capability instructions
 *
 * Skills are handled by the separate skills plugin and composed
 * at the top level in open-bot.ts.
 */
export async function buildBrainPrompt(
  baseDir: string,
  modules: BrainModules,
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

  // 2. Identity (small, always included)
  const identity = await modules.identity.getIdentity();
  if (identity) parts.push(`<identity>\n${identity}\n</identity>`);

  const soul = await modules.identity.getSoul();
  if (soul) parts.push(`<soul>\n${soul}\n</soul>`);

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

  // 4. Brain capabilities
  parts.push(`<brain_tools>
Use these to manage your persistent state:
- \`remember(content, tags)\`: Store facts/preferences
- \`recall(query, tags)\`: Search long-term memory
- \`forget(memoryId)\`: Remove outdated info
- \`journal(content)\`: Record session reflections
- \`updateIdentity(content)\`: Refine your persona
- \`readIdentity(file)\`: Inspect SOUL.md or IDENTITY.md
</brain_tools>`);

  return `\n${parts.join("\n\n")}\n`;
}
