import { createOpenAI, openai as defaultOpenai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { getCloudIntegrationsConfig, isCloudSystemAgent } from '../../app/cloud-mode.js';

let cloudOpenAIProvider: ReturnType<typeof createOpenAI> | null | undefined;

/** Strip credentials — the integrations gateway injects the provider master key. */
const integrationsFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  headers.delete('Authorization');
  headers.delete('x-api-key');
  return globalThis.fetch(input, { ...init, headers });
};

function getCloudOpenAIProvider(): ReturnType<typeof createOpenAI> | null {
  if (cloudOpenAIProvider !== undefined) return cloudOpenAIProvider;

  const config = getCloudIntegrationsConfig();
  if (!config) {
    cloudOpenAIProvider = null;
    return null;
  }

  cloudOpenAIProvider = createOpenAI({
    baseURL: `${config.baseUrl}/openai/v1`,
    apiKey: 'unused',
    headers: {
      'x-openbot-integrations-token': config.token,
    },
    fetch: integrationsFetch,
  });
  return cloudOpenAIProvider;
}

export function resolveModel(modelString: string, agentId?: string): LanguageModel {
  const [provider, ...rest] = modelString.split('/');
  const modelId = rest.join('/');
  if (!modelId) {
    throw new Error(`Invalid model string: "${modelString}". Expected "provider/model-id".`);
  }

  if (provider === 'openai' && agentId && isCloudSystemAgent(agentId)) {
    const cloudOpenai = getCloudOpenAIProvider();
    if (cloudOpenai) {
      return cloudOpenai.chat(modelId);
    }
    console.warn(
      '[openbot] Cloud mode: OPENBOT_INTEGRATIONS_BASE_URL / OPENBOT_INTEGRATIONS_TOKEN not set; falling back to direct OpenAI',
    );
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
