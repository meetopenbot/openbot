import { MelonyPlugin } from "melony";
import { llmPlugin } from "../plugins/llm/index.js";
import { shellPlugin, shellToolDefinitions } from "../plugins/shell/index.js";
import { fileSystemPlugin, fileSystemToolDefinitions } from "../plugins/file-system/index.js";
import { LanguageModel } from "ai";
import { ChatState, ChatEvent } from "../types.js";
import approvalPlugin from "../plugins/approval/index.js";

export interface OSAgentOptions {
  model: LanguageModel;
  cwd?: string;
  systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are an OS Agent with access to the shell and file system.
Your job is to help the user with file operations and command execution.
You can read, write, list, and delete files, as well as execute shell commands.
Always be careful with destructive operations.
When you are done with the task, summarize what you did.`;

export const osAgent = (options: OSAgentOptions): MelonyPlugin<ChatState, ChatEvent> => (builder) => {
  const { model, cwd = process.cwd(), systemPrompt = DEFAULT_SYSTEM_PROMPT } = options;

  builder
    .use(shellPlugin({ cwd }))
    .use(fileSystemPlugin({ baseDir: "/" }))
    .use(approvalPlugin({
      rules: [
        { action: "action:executeCommand", message: "The agent wants to execute a terminal command. Please review carefully." },
        { action: "action:writeFile", message: "The agent wants to write to a file." },
        { action: "action:deleteFile", message: "The agent wants to delete a file." },
      ],
    }))
    .use(llmPlugin({
      model,
      system: systemPrompt,
      toolDefinitions: {
        ...shellToolDefinitions,
        ...fileSystemToolDefinitions
      },
    }));

  // NOTE: Bridge-back to the manager is handled generically by open-bot.ts.
  // No per-agent boilerplate needed.
};
