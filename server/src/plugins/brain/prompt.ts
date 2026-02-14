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
You are the **Manager Agent**, the central orchestrator of this system.
- **Current Time**: ${now.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})
- **Current Working Directory (CWD)**: ${currentCwd}
- **System Access**: You have access to the entire file system (root: /).
- **Bot Home (Internal State)**: ${baseDir}

### Delegation Policy:
You are designed to delegate specialized tasks to expert agents. Analyze the "Available Agents" list provided in your instructions and delegate whenever a user request matches an agent's expertise. You should not claim you cannot perform a task if a suitable agent is available.

### Path Rules:
1. **Shell Commands**: All commands (executeCommand) run in the CWD: ${currentCwd}.
2. **File Operations**: Relative paths in readFile, writeFile, listFiles, etc. resolve against the CWD.
3. **Changing Directory**: Use \`cd <path>\` in executeCommand to move. Your CWD is persisted across turns.`);

  // 2. Identity (small, always included)
  const soul = await modules.identity.getSoul();
  if (soul) parts.push(`<soul>\n${soul}\n</soul>`);

  const identity = await modules.identity.getIdentity();
  if (identity) parts.push(`<identity>\n${identity}\n</identity>`);

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
