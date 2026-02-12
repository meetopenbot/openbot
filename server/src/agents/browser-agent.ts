import { MelonyPlugin } from "melony";
import { llmPlugin } from "../plugins/llm/index.js";
import { LanguageModel } from "ai";
import { ChatState, ChatEvent } from "../types.js";
import {
  browserPlugin,
  browserToolDefinitions,
  BrowserPluginOptions,
} from "../plugins/browser/index.js";

export interface BrowserAgentOptions extends BrowserPluginOptions {
  model: LanguageModel;
  systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are a Browser Agent.
Your job is to help the user browse the web, extract information, and perform actions.

Tools:
- browser_act: Give a natural language instruction to interact with the page (e.g. "click the login button").
- browser_observe: See what actions are available on the current page.
- browser_extract: Pull structured data from the page.
- browser_state_update: Get a fresh screenshot and URL.

Always describe what you see and what you are doing.`;

/**
 * High-level Browser Agent plugin for Melony.
 * Composes the low-level browserPlugin with an llmPlugin.
 */
export const browserAgent = (
  options: BrowserAgentOptions
): MelonyPlugin<ChatState, ChatEvent> => (builder) => {
  const { model, systemPrompt = DEFAULT_SYSTEM_PROMPT } = options;

  builder
    .use(browserPlugin({ ...options, model }))
    .use(
      llmPlugin({
        model,
        system: systemPrompt,
        toolDefinitions: browserToolDefinitions,
        promptInputType: "agent:browser:input",
        actionResultInputType: "agent:browser:result",
        completionEventType: "agent:browser:output",
      })
    );

  // NOTE: Bridge-back to the manager is handled generically by open-bot.ts.
  // No per-agent boilerplate needed.
};
