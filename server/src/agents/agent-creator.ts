import { MelonyPlugin } from "melony";
import path from "node:path";
import { llmOrchestratorPlugin } from "../services/orchestrator.js";
import {
  fileSystemToolDefinitions,
  fileSystemPlugin,
} from "../plugins/file-system.js";
import { DEFAULT_BASE_DIR, resolvePath } from "../app/config.js";
import { ConversationState, ConversationEvent } from "../app/types.js";
import { LanguageModel } from "ai";
import { PluginRegistry } from "../registry/plugin-registry.js";

export interface AgentCreatorOptions {
  model: LanguageModel;
  resolvedModelId: string;
  resolvedBaseDir: string;
  registry: PluginRegistry;
}

export const agentCreatorAgent =
  (
    options: AgentCreatorOptions,
  ): MelonyPlugin<ConversationState, ConversationEvent> =>
  (builder) => {
    const { model, resolvedModelId, resolvedBaseDir, registry } = options;
    const baseDir = resolvePath(DEFAULT_BASE_DIR);
    const agentsDir = path.join(baseDir, "agents");

    builder.use(fileSystemPlugin({ baseDir })).use(
      llmOrchestratorPlugin({
        model,
        resolvedModelId,
        resolvedBaseDir,
        registry,
        system: `You are the OpenBot Agent Creator. Your job is to help users create AND update custom OpenBot agents via natural language.

Configuration storage:
1. The Default Agent (the main orchestrator, usually named "OpenBot") is defined in: ${baseDir}/AGENT.md.
2. Custom Agents live in their own subdirectories: ${agentsDir}/<agent-name>/AGENT.md.

The AGENT.md file uses Markdown with a YAML frontmatter block at the top.

Frontmatter fields (required):
---
name: <slug-name>
description: <short description>
plugins:
  - shell
  - file-system
  - name: approval
    config:
      rules: []
---

Optional fields:
- model: <provider/model-id>
- subscribe: [<event-type>, ...]

The Markdown body below the frontmatter contains the agent's persona and detailed behavioral instructions.

Official plugin catalog (prefer these):
- shell: execute shell commands
- file-system: read/write/list/delete files
- approval: require user approval before risky actions
- browser-tools: web automation
- search: search/retrieval tools

Tool Usage:
1. Use \`listFiles\` to explore existing agents in ${agentsDir}.
2. Use \`readFile\` to inspect an existing agent's AGENT.md before updating it.
3. Use \`writeFile\` to create or update an agent's AGENT.md.

Rules:
1. Do not write files until user explicitly approves the proposed changes.
2. For updates, ALWAYS read the current AGENT.md first using \`readFile\`, then propose changes.
3. For the Default Agent, ALWAYS use ${baseDir}/AGENT.md.
4. For Custom Agents, ALWAYS use ${agentsDir}/<name>/AGENT.md.
5. If you're unsure which agent to update, use \`listFiles\` on ${agentsDir} to see available agents.
6. Prefer official plugins.
7. Keep frontmatter minimal; include only meaningful fields.
8. If required info is missing, ask focused follow-up questions.
9. After writing, confirm that the correct AGENT.md was updated.
10. The server hot-reloads ~/.openbot changes.
11. ALWAYS use the consolidated AGENT.md format. Do NOT create agent.yaml files anymore.

Workflow:
1. Determine whether this is create or update, and if it's for the Default Agent or a Custom Agent.
2. If it's an update, use \`readFile\` to get the current configuration.
3. If the agent name is ambiguous, use \`listFiles\` to find the correct one.
4. Collect missing requirements from the user.
5. Show a proposed AGENT.md content (frontmatter + instructions) and request explicit approval.
6. On approval, write the appropriate AGENT.md using \`writeFile\`.
7. Return a short completion summary.`,
        toolDefinitions: fileSystemToolDefinitions, // Give it access to write files
      }),
    );
  };
