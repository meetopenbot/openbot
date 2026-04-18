import express from 'express';
import { OpenBotEvent } from './types.js';

/** Express query values are always strings; parse JSON `data` for typed events. */
export function openBotEventFromQuery(query: express.Request['query']): OpenBotEvent {
  const typeRaw = query.type;
  const type =
    typeof typeRaw === 'string'
      ? typeRaw
      : Array.isArray(typeRaw) && typeof typeRaw[0] === 'string'
        ? typeRaw[0]
        : '';

  const dataRaw = query.data;
  const dataStr =
    typeof dataRaw === 'string'
      ? dataRaw
      : Array.isArray(dataRaw) && typeof dataRaw[0] === 'string'
        ? dataRaw[0]
        : undefined;

  if (dataStr === undefined || dataStr.trim() === '') {
    return { type } as OpenBotEvent;
  }

  try {
    const data = JSON.parse(dataStr) as unknown;
    return { type, data } as OpenBotEvent;
  } catch {
    throw new Error('Query parameter "data" must be valid JSON when provided');
  }
}

/**
 * Detects mentions in the text, returns the first agentId found,
 * and the content with ALL mentions removed.
 */
export function parseMention(content: string) {
  const mentionPattern = /@([a-z0-9-_]+)/gi;
  const matches = [...content.matchAll(mentionPattern)];

  if (matches.length === 0) return null;

  // Route to the FIRST mention
  const targetAgentId = matches[0][1].toLowerCase();

  // Strip ALL mentions from the text to keep the agent prompt clean
  const stripped = content.replace(mentionPattern, '').trim();

  return { agentId: targetAgentId, stripped };
}
