import { OpenBotEvent, OpenBotMessage } from '../app/types.js';

/**
 * Sliding window: max number of messages we replay to the model on each
 * invocation. Older turns stay on disk but are not sent. Keeps both the
 * recent prompts and the prompt token budget bounded.
 */
const MAX_WINDOW_MESSAGES = 80;

/**
 * Reconstructs a valid `OpenBotMessage[]` chain from a raw event log.
 * Handles grouping tool calls into assistant messages and matching results.
 * 
 * This replaces the old `shortTermMessages` concept by treating the event log
 * as the single source of truth for conversation history.
 */
export function reconstructHistory(events: OpenBotEvent[]): OpenBotMessage[] {
  const messages: OpenBotMessage[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'user:input':
        messages.push({ role: 'user', content: event.data.content });
        break;

      case 'agent:output': {
        const last = messages[messages.length - 1];
        if (last && last.role === 'assistant') {
          if (typeof last.content === 'string') {
            last.content += '\n' + event.data.content;
          } else if (Array.isArray(last.content)) {
            const textPart = last.content.find((p) => p.type === 'text');
            if (textPart && textPart.type === 'text') {
              textPart.text += '\n' + event.data.content;
            } else {
              last.content.unshift({ type: 'text', text: event.data.content });
            }
          }
        } else {
          messages.push({ role: 'assistant', content: event.data.content });
        }
        break;
      }

      case 'agent:invoke': {
        const invokeEvent = event as any;
        // Only treat as a message if it has content and is explicitly from a role
        if (invokeEvent.data?.content && invokeEvent.data?.role) {
          const role = invokeEvent.data.role as 'user' | 'assistant' | 'system';
          messages.push({ role, content: invokeEvent.data.content } as OpenBotMessage);
        }
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
            } else {
              last.content.push(toolCall);
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

          const last = messages[messages.length - 1];
          if (last && last.role === 'tool' && Array.isArray(last.content)) {
            last.content.push({
              type: 'tool-result',
              toolCallId,
              toolName,
              output: (event as any).data,
            });
          } else {
            messages.push({
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolCallId,
                  toolName,
                  output: (event as any).data,
                },
              ],
            });
          }
        }
        break;
    }
  }

  return repairAndWindow(messages);
}

/**
 * Self-healing pass: every assistant tool_call must have a matching tool
 * result before the next user/assistant turn. Also applies the sliding window.
 */
function repairAndWindow(messages: OpenBotMessage[]): OpenBotMessage[] {
  const fulfilled = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool' && Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === 'tool-result') {
          fulfilled.add(part.toolCallId);
        }
      }
    }
  }

  const repaired: OpenBotMessage[] = [];
  for (const m of messages) {
    repaired.push(m);
    if (m.role !== 'assistant' || typeof m.content === 'string') continue;

    const missingResults: any[] = [];
    for (const part of m.content) {
      if (part.type === 'tool-call' && !fulfilled.has(part.toolCallId)) {
        missingResults.push({
          type: 'tool-result',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: {
            success: false,
            error: 'Tool result was lost (handler did not emit a matching :result event).',
          },
        });
        fulfilled.add(part.toolCallId);
      }
    }

    if (missingResults.length > 0) {
      repaired.push({
        role: 'tool',
        content: missingResults,
      });
    }
  }

  if (repaired.length <= MAX_WINDOW_MESSAGES) return repaired;

  const tail = repaired.slice(-MAX_WINDOW_MESSAGES);
  
  // Ensure the tail doesn't start with an orphan tool result
  const knownAssistantCallIds = new Set<string>();
  for (const m of tail) {
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === 'tool-call') knownAssistantCallIds.add(part.toolCallId);
      }
    }
  }

  return tail.filter((m) => {
    if (m.role !== 'tool' || typeof m.content === 'string') return true;
    return m.content.some((part) => part.type === 'tool-result' && knownAssistantCallIds.has(part.toolCallId));
  });
}
