import { OpenBotEvent } from '../../app/types.js';
import { ToolResultPart, type ModelMessage } from 'ai';

/**
 * Converts a raw event log into a valid chain of ModelMessages for the AI SDK.
 * 
 * This is a basic implementation that maps events to messages and filters out
 * events from sub-processes (delegation) to avoid duplication in history.
 */
export function eventsToModelMessages(events: OpenBotEvent[]): ModelMessage[] {
  const messages: ModelMessage[] = [];

  for (const event of events) {
    // Skip events that belong to a sub-process (like delegation)
    // so they don't pollute the main conversation history.
    if (event.meta?.parentToolCallId) {
      continue;
    }

    switch (event.type) {
      case 'agent:output': {
        const last = messages[messages.length - 1];
        if (last && last.role === 'assistant' && typeof last.content === 'string') {
          last.content += event.data.content;
        } else {
          messages.push({ role: 'assistant', content: event.data.content });
        }
        break;
      }

      case 'agent:invoke': {
        const invokeEvent = event as any;
        if (invokeEvent.data?.content && invokeEvent.data?.role) {
          messages.push({
            role: invokeEvent.data.role,
            content: invokeEvent.data.content
          } as ModelMessage);
        }
        break;
      }

      case 'agent:hint': {
        messages.push({
          role: 'system',
          content: event.data.content
        } as any);
        break;
      }

      default:
        // Handle tool calls (action:*)
        if (event.type.startsWith('action:') && !event.type.endsWith(':result')) {


          const toolName = event.type.slice(7);
          const toolCallId = event.meta?.toolCallId;
          if (!toolCallId) break;

          const toolCall = {
            type: 'tool-call' as const,
            toolCallId,
            toolName,
            input: (event as any).data,
          };

          const last = messages[messages.length - 1];

          if (last && last.role === 'assistant') {
            if (typeof last.content === 'string') {
              last.content = [
                { type: 'text', text: last.content },
                toolCall,
              ];
            } else if (Array.isArray(last.content)) {
              (last.content as any[]).push(toolCall);
            }
          } else {
            messages.push({
              role: 'assistant',
              content: [toolCall],
            });
          }
        }
        // Handle tool results (action:*:result)
        else if (event.type.startsWith('action:') && event.type.endsWith(':result')) {
          const toolName = event.type.slice(7, -7);
          const toolCallId = event.meta?.toolCallId;
          if (!toolCallId) break;

          const toolResult: ToolResultPart = {
            type: 'tool-result' as const,
            toolCallId,
            toolName,
            output: {
              type: 'text',
              value: (event as any)?.data?.output || "No output", // ?.output is from delegation result
            },
          };

          const last = messages[messages.length - 1];
          if (last && last.role === 'tool' && Array.isArray(last.content)) {
            (last.content as any[]).push(toolResult);
          } else {
            messages.push({
              role: 'tool',
              content: [toolResult],
            });
          }
        }
        break;
    }
  }

  return messages;
}
