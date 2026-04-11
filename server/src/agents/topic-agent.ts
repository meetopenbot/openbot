import { MelonyPlugin } from "melony";
import { generateText, LanguageModel } from "ai";
import { ConversationState, ConversationEvent } from "../app/types.js";

function getTitleSourceMessages(state: ConversationState): any[] {
  if (Array.isArray(state.messages) && state.messages.length >= 2) {
    return state.messages;
  }
  return [];
}

export const topicAgent =
  (options: {
    model: LanguageModel;
  }): MelonyPlugin<ConversationState, ConversationEvent> =>
  (builder) => {
    builder.on("agent:output" as any, async function* (event, { state }) {
      // Only title if it doesn't have one and there's history
      if (state.title) {
        return;
      }

      const messagesForTitle = getTitleSourceMessages(state);

      // Don't title if there are too few messages
      if (messagesForTitle.length < 2) {
        return;
      }

      try {
        const { text } = await generateText({
          model: options.model,
          system:
            "You are a Topic Agent. Create a very concise (3-5 words) title for the conversation based on the user's intent. Do not use quotes or special characters.",
          prompt: `Analyze these messages and provide a title: ${JSON.stringify(messagesForTitle.slice(0, 6))}`,
        });

        const newTitle = text.replace(/["']/g, "").trim();
        if (newTitle) {
          state.title = newTitle;

          // Notify the client to refresh the conversations list in the sidebar
          yield {
            type: "client:invalidate",
            data: { tags: ["conversations", "channels"] },
          } as any;
        }
      } catch (error) {
        console.error("[topic-agent] Failed to generate title:", error);
      }
    });
  };
