import { openai as defaultOpenai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

export function resolveModel(modelString: string): LanguageModel {
  const [provider, ...rest] = modelString.split('/');
  const modelId = rest.join('/');
  if (!modelId) {
    throw new Error(`Invalid model string: "${modelString}". Expected "provider/model-id".`);
  }

  switch (provider) {
    case 'openai':
      return defaultOpenai(modelId);
    case 'anthropic':
      return anthropic(modelId);
    case 'google':
      return google(modelId);
    default:
      throw new Error(`Unsupported AI provider: "${provider}"`);
  }
}
