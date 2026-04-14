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
