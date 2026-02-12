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
  parts.push(`## Environment
You are running as a global system agent.
- **Current Time**: ${now.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})
- **Current Working Directory (CWD)**: ${currentCwd}
- **System Access**: You have access to the entire file system (root: /).
- **Bot Home (Internal State)**: ${baseDir}

### Path Rules:
1. **Shell Commands**: All commands (executeCommand) run in the CWD: ${currentCwd}.
2. **File Operations**: Relative paths in readFile, writeFile, listFiles, etc. resolve against the CWD.
3. **Changing Directory**: Use \`cd <path>\` in executeCommand to move. Your CWD is persisted across turns.
4. **Skills/Memory**: To access your own skills and memory, use absolute paths starting with "${baseDir}/".

When you want to execute skill scripts, always use the full path to the skill directory.`);

  // 2. Identity (small, always included)
  const soul = await modules.identity.getSoul();
  if (soul) parts.push(soul);

  const identity = await modules.identity.getIdentity();
  if (identity) parts.push(identity);

  // 3. Recent memories (lean — just a few to keep context fresh)
  const recentFacts = await modules.memory.getRecentFacts(3);
  if (recentFacts.length > 0) {
    const factsList = recentFacts
      .map(
        (f) =>
          `- ${f.content}${f.tags.length > 0 ? ` [${f.tags.join(", ")}]` : ""}`
      )
      .join("\n");
    parts.push(`## Recent Memory

These are your most recent memories. Use \`recall\` to search for more specific information.

${factsList}`);
  }

  // 4. Brain capabilities
  parts.push(`## Brain Capabilities

You have a brain with long-term memory:
- Use \`remember\` to store important facts, user preferences, or learned context
- Use \`recall\` to search your memory when you need past information
- Use \`forget\` to remove outdated or incorrect memories
- Use \`journal\` to record session notes and reflections
- Use \`updateIdentity\` to refine your personality in IDENTITY.md
- SOUL.md contains your core values and is protected from modification`);

  return parts.join("\n\n");
}
