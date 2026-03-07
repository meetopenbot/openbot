import { MelonyPlugin, Event, RuntimeContext } from "melony";
import { streamText, LanguageModel, ModelMessage, Output } from "ai";
import { z } from "zod";
import { SimpleMessage } from "../../types.js";

async function toInlineDataUrl(url: string, mimeType: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

async function toModelMessages(messages: SimpleMessage[]): Promise<ModelMessage[]> {
  return Promise.all(messages.map(async (message) => {
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
        const attachmentParts = await Promise.all(
          message.attachments.map(async (a) => {
            if (a.mimeType.startsWith("image/")) {
              try {
                return {
                  type: "image",
                  image: await toInlineDataUrl(a.url, a.mimeType),
                };
              } catch (error) {
                console.warn(
                  `Failed to inline image attachment (${a.name}). Falling back to URL: ${a.url}`,
                  error
                );
                return {
                  type: "image",
                  image: a.url,
                };
              }
            }
            return {
              type: "file",
              data: a.url,
              mimeType: a.mimeType,
            };
          })
        );

        return {
          role: "user",
          content: [
            { type: "text", text: message.content as string },
            ...attachmentParts,
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
  }));
}

// Helper to find pending tool calls in history
function getPendingToolCalls(messages: SimpleMessage[]): any[] {
  const toolResults = new Set<string>();
  let lastAssistantWithTools: any = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      msg.content.forEach((c: any) => {
        if (c.toolCallId) toolResults.add(c.toolCallId);
      });
    }
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      if (msg.content.some((c: any) => c.type === "tool-call")) {
        lastAssistantWithTools = msg;
      }
    }
  }

  if (lastAssistantWithTools) {
    return lastAssistantWithTools.content.filter(
      (c: any) => c.type === "tool-call" && !toolResults.has(c.toolCallId)
    );
  }
  return [];
}

// Helper to insert tool result message in correct position (immediately after corresponding assistant msg)
function insertToolResult(messages: SimpleMessage[], toolResultMsg: SimpleMessage) {
  if (toolResultMsg.role !== "tool" || !Array.isArray(toolResultMsg.content)) return;
  const toolCallId = toolResultMsg.content[0]?.toolCallId;
  if (!toolCallId) return;

  // Find the assistant message that called this tool
  let assistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      if (msg.content.some((c: any) => c.toolCallId === toolCallId)) {
        assistantIdx = i;
        break;
      }
    }
  }

  if (assistantIdx !== -1) {
    // Find if there's already a tool message after this assistant message
    let toolMsgIdx = -1;
    for (let i = assistantIdx + 1; i < messages.length; i++) {
      if (messages[i].role === "tool") {
        toolMsgIdx = i;
        break;
      }
      if (messages[i].role === "assistant") break;
    }

    if (toolMsgIdx !== -1) {
      // Merge into existing tool message
      const toolMsg = messages[toolMsgIdx];
      if (Array.isArray(toolMsg.content)) {
        toolMsg.content.push(...toolResultMsg.content);
      }
    } else {
      // Insert new tool message after assistant
      messages.splice(assistantIdx + 1, 0, toolResultMsg);
    }
  } else {
    // Fallback: push to end
    messages.push(toolResultMsg);
  }
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
  /**
   * Optional Zod schema for structured output.
   * If provided, the plugin uses `streamObject` instead of `streamText`.
   */
  outputSchema?: z.ZodType<any>;
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
      outputSchema,
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

    // 1. Add new message to history with correct positioning and unblocking logic.
    if (newMessage) {
      if (newMessage.role === "tool") {
        insertToolResult(state.messages, newMessage);
      } else {
        // If a new user message arrives while tools are pending, we unblock by failing the tools.
        if (newMessage.role === "user") {
          const pending = getPendingToolCalls(state.messages);
          if (pending.length > 0) {
            console.warn(
              `User message received while tools are pending. Failing pending tools to unblock: ${pending
                .map((p: any) => p.toolName)
                .join(", ")}`
            );
            for (const p of pending) {
              insertToolResult(state.messages, {
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: p.toolCallId,
                    toolName: p.toolName,
                    output: {
                      type: "text",
                      value: "Tool failed to respond in time (unblocked by user message).",
                    },
                  },
                ],
              });
            }
          }
        }
        state.messages.push(newMessage);
      }
    }

    // 2. Check for pending tool calls. We MUST have results for all tool calls before continuing.
    const pending = getPendingToolCalls(state.messages);
    if (pending.length > 0) {
      console.log(
        `Waiting for ${pending.length} pending tool results: ${pending
          .map((p: any) => p.toolName)
          .join(", ")}`
      );
      return;
    }

    // Evaluate dynamic system prompt if it's a function
    const systemPrompt = typeof system === "function" ? await system(context) : system;

    const modelMessages = await toModelMessages(state.messages as SimpleMessage[]);

    // Initialize an empty assistant message to be populated as we stream
    const assistantMessage: SimpleMessage = { role: "assistant", content: "" };
    state.messages.push(assistantMessage);

    // console.log("messages:::::", JSON.stringify(state.messages, null, 2));
    // console.log("modelMessages:::::", JSON.stringify(modelMessages, null, 2));

    const result = streamText({
      model,
      system: systemPrompt,
      messages: modelMessages,
      tools: toolDefinitions,
      output: outputSchema ? Output.object({ schema: outputSchema }) : undefined,
      onError: (error) => {
        console.error("streamText error:::::", JSON.stringify(error, null, 2));
      },
    });

    if (outputSchema) {
      for await (const delta of result.partialOutputStream) {
        if (!silent) {
          yield {
            type: "agent:output-delta",
            data: { delta: "", content: JSON.stringify(delta) },
          } as Event;
        }
      }

      const finalObject = await result.output;
      assistantMessage.content = JSON.stringify(finalObject);

      if (completionEventType && !silent) {
        yield {
          type: completionEventType,
          data: finalObject,
        } as Event;
      }
    } else {
      for await (const delta of result.textStream) {
        assistantMessage.content += delta;
        if (!silent) {
          yield {
            type: "agent:output-delta",
            data: { delta, content: assistantMessage.content },
          } as Event;
        }
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
        // If it's structured output, we already yielded the final object
        if (!outputSchema) {
          yield {
            type: completionEventType,
            data: { content: assistantText },
          } as Event;
        }
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
    const { action, result, toolCallId, halt } = event.data as any;
    const normalizedAction = typeof action === "string" ? action : "unknown";
    const summary = typeof result === "string" ? result : JSON.stringify(result);
    const toolResultMessage: SimpleMessage = {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId,
        toolName: normalizedAction,
        output: {
          type: "text",
          value: summary,
        },
      }],
    };

    // Hard-stop mode: record tool result to unblock pending calls, but do not
    // continue the autonomous tool loop in this turn.
    if (halt === true) {
      const state = context.state as any;
      if (!state.messages) {
        state.messages = [] as SimpleMessage[];
      }
      insertToolResult(state.messages, toolResultMessage);
      return;
    }

    yield* routeToLLM(
      toolResultMessage,
      context
    );
  });
};
