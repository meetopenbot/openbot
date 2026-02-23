import { MelonyPlugin, Event, RuntimeContext } from "melony";
import { streamText, LanguageModel } from "ai";
import { z } from "zod";

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
  usageEventType?: string;
  usageScope?: string;
  modelId?: string;
  contextWindowTokens?: number;
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
    completionEventType,
    usageEventType = "usage:update",
    usageScope = "default",
    modelId,
    contextWindowTokens,
  } = options;

  async function* routeToLLM(
    newMessage: SimpleMessage,
    context: RuntimeContext,
    silent: boolean = false
  ): AsyncGenerator<Event, void, unknown> {
    const state = context.state as any;

    if (!state.messages) {
      state.messages = [] as SimpleMessage[];
    }

    // Add new message to history
    state.messages.push(newMessage);

    // Evaluate dynamic system prompt if it's a function
    const systemPrompt = typeof system === "function" ? await system(context) : system;

    const recentMessages = getRecentHistory(state.messages, 20);
    
    // Initialize an empty assistant message to be populated as we stream
    const assistantMessage: SimpleMessage = { role: "assistant", content: "" };
    state.messages.push(assistantMessage);

    const result = streamText({
      model,
      system: systemPrompt,
      messages: recentMessages,
      tools: toolDefinitions,
    });

    for await (const delta of result.textStream) {
      assistantMessage.content += delta;
      if (!silent) {
        yield {
          type: "assistant:text-delta",
          data: { delta, content: assistantMessage.content },
        } as Event;
      }
    }

    const assistantText = assistantMessage.content;

    // Wait for tool calls to complete
    const toolCalls = await result.toolCalls;

    // Remove the message if it's empty (e.g. only tool calls)
    if (!assistantText) {
      state.messages = state.messages.filter((m: SimpleMessage) => m !== assistantMessage);
    } else {
      if (completionEventType && !silent) {
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

    if (!silent) {
      const windowSize = contextWindowTokens ?? 0;
      yield {
        type: usageEventType,
        data: {
          scope: usageScope,
          model: modelId,
          turn: {
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            totalTokens: usage.totalTokens ?? 0,
          },
          session: {
            inputTokens: state.usage.inputTokens,
            outputTokens: state.usage.outputTokens,
            totalTokens: state.usage.totalTokens,
          },
          contextWindowTokens: windowSize,
          contextUsedRatio: windowSize > 0 ? Math.min(state.usage.totalTokens / windowSize, 1) : 0,
        },
      } as Event;
    }

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
