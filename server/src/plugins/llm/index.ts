import { MelonyPlugin, Event, RuntimeContext } from "melony";
import { streamText, LanguageModel } from "ai";
import { z } from "zod";
import {
  buildShapedContext,
  updateContextState,
  type ConversationContextState,
  type SimpleMessage,
} from "./context-shaping.js";

interface AttachmentRef {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
}

interface ToolObservation {
  id: string;
  action: string;
  ok: boolean;
  summary: string;
  createdAt: string;
}

const MAX_TOOL_OBSERVATIONS = 24;
const MAX_OBSERVATION_SUMMARY_CHARS = 1600;
const OBSERVATION_PROMPT_LIMIT = 8;

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function summarizeActionResult(result: unknown): string {
  const serialized = typeof result === "string" ? result : safeJson(result);
  return clipText(serialized, MAX_OBSERVATION_SUMMARY_CHARS);
}

function toObservationPromptBlock(observations: ToolObservation[]): string {
  if (observations.length === 0) return "";
  const lines = observations
    .slice(-OBSERVATION_PROMPT_LIMIT)
    .map((observation, index) => {
      const status = observation.ok ? "success" : "failure";
      return `${index + 1}. action=${observation.action}; status=${status}; summary=${observation.summary}`;
    })
    .join("\n");
  return `<tool_observations>\nUse these as trusted tool outputs for the current reasoning step.\n${lines}\n</tool_observations>`;
}

async function buildMessageContent(message: SimpleMessage): Promise<any> {
  if (!message.attachments?.length) return message.content;

  const parts: any[] = [];
  const trimmed = message.content.trim();
  if (trimmed) {
    parts.push({ type: "text", text: trimmed });
  }

  for (const attachment of message.attachments) {
    if (!attachment?.mimeType?.startsWith("image/")) continue;
    if (!attachment.url) continue;

    try {
      const response = await fetch(attachment.url);
      if (!response.ok) continue;
      const bytes = await response.arrayBuffer();
      parts.push({
        type: "image",
        image: Buffer.from(bytes),
        mimeType: attachment.mimeType,
      });
    } catch {
      // Best-effort multimodal handling: skip failed image fetches.
    }
  }

  return parts.length > 0 ? parts : message.content;
}

async function toModelMessages(messages: SimpleMessage[]): Promise<any[]> {
  const built = await Promise.all(
    messages.map(async (message) => ({
      role: message.role,
      content: await buildMessageContent(message),
    }))
  );
  return built;
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
  contextShaping?: {
    maxRecentRawMessages?: number;
    maxRelevantMessages?: number;
    maxContextChars?: number;
    maxTurnSummaries?: number;
    maxConstraints?: number;
  };
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
    contextShaping,
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
    const baseSystemPrompt = typeof system === "function" ? await system(context) : system;
    const observations = Array.isArray(state.toolObservations)
      ? (state.toolObservations as ToolObservation[])
      : [];
    const observationBlock = toObservationPromptBlock(observations);
    const systemPrompt = observationBlock
      ? `${baseSystemPrompt ?? ""}\n\n${observationBlock}`
      : baseSystemPrompt;

    const shapedMessages = buildShapedContext({
      messages: state.messages as SimpleMessage[],
      contextState: state.contextState as ConversationContextState | undefined,
      options: contextShaping,
    });
    const modelMessages = await toModelMessages(shapedMessages);
    
    // Initialize an empty assistant message to be populated as we stream
    const assistantMessage: SimpleMessage = { role: "assistant", content: "" };
    state.messages.push(assistantMessage);

    console.log("systemPrompt:::::", systemPrompt);
    console.log("modelMessages:::::", JSON.stringify(modelMessages, null, 2));

    const result = streamText({
      model,
      system: systemPrompt,
      messages: modelMessages,
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

    const latestUserMessage = newMessage?.role === "user" ? newMessage.content : "";
    state.contextState = updateContextState(
      {
        contextState: state.contextState as ConversationContextState | undefined,
        latestUserMessage,
        latestAssistantMessage: assistantText,
      },
      contextShaping
    );

    // Tool observations are only for the immediate follow-up step after tools run.
    state.toolObservations = [];

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
    const { action, result } = event.data as any;
    const normalizedAction = typeof action === "string" ? action : "unknown";
    const summary = summarizeActionResult(result);
    yield* routeToLLM(
      {
        role: "system",
        content: `Action "${normalizedAction}" completed: ${summary}`,
      },
      context
    );
  });
};
