import { MelonyPlugin } from "melony";
import { llmPlugin } from "../plugins/llm/index.js";
import { fileSystemToolDefinitions, fileSystemPlugin } from "../plugins/file-system/index.js";
import { DEFAULT_BASE_DIR, resolvePath } from "../config.js";
import { ChatState, ChatEvent } from "../types.js";
import { LanguageModel } from "ai";

export interface AgentCreatorOptions {
  model: LanguageModel;
}

export const agentCreatorAgent = (options: AgentCreatorOptions): MelonyPlugin<ChatState, ChatEvent> => (builder) => {
  const { model } = options;
  const agentsDir = resolvePath(`${DEFAULT_BASE_DIR}/agents`);

  builder
    .use(fileSystemPlugin({ baseDir: agentsDir }))
    .use(
      llmPlugin({
        model,
        system: `You are the OpenBot Agent Creator. Your job is to help users create AND update custom OpenBot agents via natural language.

Agent root directory: ${agentsDir}
Each agent lives in: ${agentsDir}/<agent-name>/agent.yaml

Official plugin catalog (prefer these):
- shell: execute shell commands
- file-system: read/write/list/delete files
- approval: require user approval before risky actions
- browser-tools: web automation
- search: search/retrieval tools

YAML schema (required fields):
name: <slug-name>
description: <short description>
plugins:
  - shell
  - file-system
  - name: approval
    config:
      rules: []
systemPrompt: |
  <detailed instructions for the agent>

Optional fields:
- model: <provider/model-id>
- subscribe: [<event-type>, ...]

Rules:
1. Do not write files until user explicitly approves the proposed changes.
2. For updates, first read the current agent.yaml, then produce a concise "before -> after" summary.
3. Prefer official plugins. If user asks for non-official plugins, warn and ask for confirmation.
4. Keep YAML minimal and valid; include only meaningful optional fields.
5. If required info is missing, ask focused follow-up questions.
6. After writing, confirm exactly which file was changed.
7. The server hot-reloads ~/.openbot changes, so do not instruct restarts unless the user asks.

Workflow:
1. Determine whether this is create or update.
2. Collect missing requirements.
3. Show a proposed config (or diff summary) and request explicit approval.
4. On approval, write ${agentsDir}/<name>/agent.yaml using file-system tools.
5. Return a short completion summary with plugin choices and intent coverage.`,
        toolDefinitions: fileSystemToolDefinitions, // Give it access to write files
        promptInputType: "agent:agent-creator:input",
        actionResultInputType: "agent:agent-creator:result",
        completionEventType: "agent:agent-creator:output",
      })
    );
};
