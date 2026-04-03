import { MelonyPlugin } from "melony";
import { llmOrchestratorPlugin } from "../plugins/orchestrator.js";
import { shellPlugin, shellToolDefinitions } from "../plugins/shell.js";
import {
  fileSystemPlugin,
  fileSystemToolDefinitions,
} from "../plugins/file-system.js";
import { LanguageModel } from "ai";
import { ConversationState, ConversationEvent } from "../app/types.js";
import approvalPlugin from "../plugins/approval.js";
import { PluginRegistry } from "../registry/plugin-registry.js";

export interface OSAgentOptions {
  model: LanguageModel;
  resolvedModelId: string;
  resolvedBaseDir: string;
  registry: PluginRegistry;
  cwd?: string;
  systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are an OS Agent with access to the shell and file system.
Your job is to help the user with file operations and command execution.
You can read, write, list, and delete files, as well as execute shell commands.
Always be careful with destructive operations.
When you are done with the task, summarize what you did.`;

export const osAgent =
  (
    options: OSAgentOptions,
  ): MelonyPlugin<ConversationState, ConversationEvent> =>
  (builder) => {
    const {
      model,
      resolvedModelId,
      resolvedBaseDir,
      registry,
      cwd = process.cwd(),
      systemPrompt = DEFAULT_SYSTEM_PROMPT,
    } = options;

    builder
      .use(shellPlugin({ cwd }))
      .use(fileSystemPlugin({ baseDir: "/" }))
      .use(
        approvalPlugin({
          rules: [
            {
              action: "action:executeCommand",
              message:
                "The agent wants to execute a terminal command. Please review carefully.",
            },
            {
              action: "action:deleteFile",
              message: "The agent wants to delete a file.",
            },
          ],
        }),
      )
      .use(
        llmOrchestratorPlugin({
          model,
          resolvedModelId,
          resolvedBaseDir,
          registry,
          system: systemPrompt,
          toolDefinitions: {
            ...shellToolDefinitions,
            ...fileSystemToolDefinitions,
          },
        }),
      );
  };
