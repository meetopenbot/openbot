import { MelonyPlugin, Event, RuntimeContext } from "melony";
import { streamText, LanguageModel } from "ai";
import { z } from "zod";
import { ui } from "@melony/ui-kit";

interface SimpleMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Builds a simple history summary from recent messages.
 * Keeps the last N messages as simple role/content pairs.
 */
function getRecentHistory(messages: SimpleMessage[], maxMessages: number): SimpleMessage[] {
  return messages.slice(-maxMessages);
}

export interface LLMPluginOptions {
  model: LanguageModel;
  system?: string | ((context: RuntimeContext) => string | Promise<string>);
  /**
   * Optional mapping of tool names to their descriptions and schemas.
   * Tool calls will emit events with the same name.
   */
  toolDefinitions?: Record<string, {
    description: string;
    inputSchema: z.ZodType<any>;
  }>;
  actionEventPrefix?: string;
  promptInputType?: string;
  actionResultInputType?: string;
  completionEventType?: string;
}

/**
 * LLM Plugin for Melony.
 * Automatically handles text events and routes them through an LLM using Vercel AI SDK.
 * It can also automatically trigger events based on tool calls.
 */
export const llmPlugin = (options: LLMPluginOptions): MelonyPlugin<any, any> => (builder) => {
  const { 
    model, 
    system, 
    toolDefinitions = {}, 
    actionEventPrefix = "action:", 
    promptInputType = "user:text", 
    actionResultInputType = "action:taskResult",
    completionEventType
  } = options;

  async function* routeToLLM(
    newMessage: SimpleMessage,
    context: RuntimeContext
  ): AsyncGenerator<Event, void, unknown> {
    const state = context.state as any;

    if (!state.messages) {
      state.messages = [] as SimpleMessage[];
    }

    // Add new message to history
    state.messages.push(newMessage);

    // Evaluate dynamic system prompt if it's a function
    const systemPrompt = typeof system === "function" ? await system(context) : system;

    const result = streamText({
      model,
      system: systemPrompt,
      messages: getRecentHistory(state.messages, 20).map(m =>
        m.role === "system" ? { role: "user", content: `System: ${m.content}` } : m
      ) as any,
      tools: toolDefinitions,
    });

    let assistantText = "";
    for await (const delta of result.textStream) {
      assistantText += delta;
      yield {
        type: "assistant:text-delta",
        data: { delta },
      } as Event;
    }

    // Wait for tool calls to complete
    const toolCalls = await result.toolCalls;

    // Store assistant response as simple text
    if (assistantText) {
      state.messages.push({
        role: "assistant",
        content: assistantText,
      });

      if (completionEventType) {
        yield {
          type: completionEventType,
          data: { content: assistantText },
        } as Event;
      }
    }

    const usage = await result.usage;

    if (!state.usage) {
      state.usage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };
    }

    state.usage.inputTokens += usage.inputTokens ?? 0;
    state.usage.outputTokens += usage.outputTokens ?? 0;
    state.usage.totalTokens += usage.totalTokens ?? 0;

    // Emit tool call events
    for (const call of toolCalls) {
      yield {
        type: `${actionEventPrefix}${call.toolName}`,
        data: {
          ...call.input,
          toolCallId: call.toolCallId,
        },
      } as Event;
    }
  }

  // Handle user text input
  builder.on(promptInputType, async function* (event, context) {
    const content = event.data.content;
    yield* routeToLLM({ role: "user", content }, context);
  });

  // Feed action results back to the LLM as user messages (with a System prefix)
  // We use "user" role instead of "system" to avoid errors with providers like Anthropic
  // that don't support multiple system messages or system messages after the first turn.
  builder.on(actionResultInputType, async function* (event, context) {
    const { action, result } = event.data as any;
    const summary = typeof result === "string" ? result : JSON.stringify(result);
    yield* routeToLLM({ role: "user", content: `System: Action "${action}" completed: ${summary}` }, context);
  });
};
