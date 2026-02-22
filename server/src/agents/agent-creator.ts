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
        system: `You are the OpenBot Agent Creator. Your job is to help users build custom OpenBot agents via natural language.

An OpenBot agent is defined by a folder in ${agentsDir} containing an \`agent.yaml\` file.

The YAML format is:
name: <slug-name>
description: <short description>
plugins:
  - name: file-system
  - name: shell
  - name: browser # (if they need web access)
systemPrompt: |
  <detailed instructions for the agent>

Your workflow:
1. Ask the user what kind of agent they want to build (if they haven't provided enough detail).
2. Suggest a name, description, required plugins, and a draft system prompt.
3. Once the user approves, use the file-system tools to create the directory ${agentsDir}/<name> and write the \`agent.yaml\` file inside it.
4. Tell the user they may need to restart the OpenBot server for the new agent to be registered.`,
        toolDefinitions: fileSystemToolDefinitions, // Give it access to write files
        promptInputType: "agent:agent-creator:input",
        actionResultInputType: "agent:agent-creator:result",
        completionEventType: "agent:agent-creator:output",
      })
    );
};
