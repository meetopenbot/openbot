import { MelonyPlugin, Event, RuntimeContext } from "melony";
import { streamText, LanguageModel, ModelMessage } from "ai";
import { z } from "zod";
import { SimpleMessage } from "../../types.js";

async function toModelMessages(messages: SimpleMessage[]): Promise<ModelMessage[]> {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        content: Array.isArray(message.content)
          ? message.content.map((c: any) => {
              const result = c.result ?? c.output?.value ?? c.output;
              return {
                type: "tool-result",
                toolCallId: c.toolCallId,
                toolName: c.toolName,
                output:
                  typeof result === "string"
                    ? { type: "text", value: result }
                    : { type: "json", value: result as any },
              };
            })
          : [],
      } as ModelMessage;
    }

    if (message.role === "assistant") {
      if (Array.isArray(message.content)) {
        return {
          role: "assistant",
          content: message.content.map((c: any) => {
            if (c.type === "tool-call") {
              return {
                type: "tool-call",
                toolCallId: c.toolCallId,
                toolName: c.toolName,
                input: c.input,
              };
            }
            if (c.type === "text") {
              return c;
            }
            // Fallback for character spread bug fix
            if (typeof c === "string") {
              return { type: "text", text: c };
            }
            return c;
          }),
        } as ModelMessage;
      }
      return {
        role: "assistant",
        content: message.content,
      } as ModelMessage;
    }

    if (message.role === "user") {
      if (message.attachments && message.attachments.length > 0) {
        return {
          role: "user",
          content: [
            { type: "text", text: message.content as string },
            ...message.attachments.map((a) => {
              if (a.mimeType.startsWith("image/")) {
                return {
                  type: "image",
                  image: a.url,
                };
              }
              return {
                type: "file",
                data: a.url,
                mimeType: a.mimeType,
              };
            }),
          ],
        } as ModelMessage;
      }
      return {
        role: "user",
        content: message.content as string,
      } as ModelMessage;
    }

    return {
      role: message.role as any,
      content: message.content as any,
    } as ModelMessage;
  });
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
    promptInputType = "agent:input",
    actionResultInputType = "action:result",
    completionEventType = "agent:output",
    usageEventType = "usage:update",
    usageScope = "default",
    modelId,
  } = options;

  async function* routeToLLM(
    newMessage: SimpleMessage | undefined,
    context: RuntimeContext,
    silent: boolean = false
  ): AsyncGenerator<Event, void, unknown> {
    const state = context.state as any;

    if (!state.messages) {
      state.messages = [] as SimpleMessage[];
    }

    // Add new message to history when this invocation is user-driven.
    if (newMessage) {
      state.messages.push(newMessage);
    }

    // Evaluate dynamic system prompt if it's a function
    const systemPrompt = typeof system === "function" ? await system(context) : system;

    const modelMessages = await toModelMessages(state.messages as SimpleMessage[]);

    // Initialize an empty assistant message to be populated as we stream
    const assistantMessage: SimpleMessage = { role: "assistant", content: "" };
    state.messages.push(assistantMessage);

    console.log("messages:::::", JSON.stringify(state.messages, null, 2));
    console.log("modelMessages:::::", JSON.stringify(modelMessages, null, 2));

    const result = streamText({
      model,
      system: systemPrompt,
      messages: modelMessages,
      tools: toolDefinitions,
      onError: (error) => {
        console.error("streamText error:::::", JSON.stringify(error, null, 2));
      },
    });

    for await (const delta of result.textStream) {
      assistantMessage.content += delta;
      if (!silent) {
        yield {
          type: "agent:output-delta",
          data: { delta, content: assistantMessage.content },
        } as Event;
      }
    }

    const assistantText = assistantMessage.content as string;

    // Wait for tool calls to complete
    const toolCalls = await result.toolCalls;

    if (toolCalls && toolCalls.length > 0) {
      const parts: any[] = [];
      if (assistantText) {
        parts.push({ type: "text", text: assistantText });
      }
      parts.push(
        ...toolCalls.map((c) => ({
          type: "tool-call",
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          input: c.input,
        }))
      );
      assistantMessage.content = parts;
    }

    // Remove the message if it's empty (e.g. only tool calls)
    if (!assistantText && (!toolCalls || toolCalls.length === 0)) {
      state.messages = state.messages.filter((m: SimpleMessage) => m !== assistantMessage);
    } else {
      if (completionEventType && !silent) {
        yield {
          type: completionEventType,
          data: { result: assistantText },
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
    const content = typeof event.data?.content === "string" ? event.data.content : "";
    const attachments = Array.isArray(event.data?.attachments) ? event.data.attachments : undefined;
    yield* routeToLLM({ role: "user", content, attachments }, context);
  });

  // Feed action results back as system-role feedback to the model.
  builder.on(actionResultInputType, async function* (event, context) {
    const { action, result, toolCallId } = event.data as any;
    const normalizedAction = typeof action === "string" ? action : "unknown";
    const summary = typeof result === "string" ? result : JSON.stringify(result);

    yield* routeToLLM(
      {
        role: "tool",
        content: [{
          type: 'tool-result',
          toolCallId,
          toolName: normalizedAction,
          output: {
            type: 'text',
            value: summary,
          },
        }],
      },
      context
    );
  });
};
