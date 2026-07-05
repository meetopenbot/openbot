import { createOpenAI, openai as defaultOpenai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import {
  getCloudIntegrationsConfig,
  isCloudSystemAgent,
} from '../../app/cloud-mode.js';

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

function resolveOpenbotModel(modelId: string, agentId?: string): LanguageModel {
  if (!agentId || !isCloudSystemAgent(agentId)) {
    throw new Error(
      `OpenBot models are only available for the cloud system agent. Use openai/..., anthropic/..., etc.`,
    );
  }

  const cloudOpenai = getCloudOpenAIProvider();
  if (!cloudOpenai) {
    throw new Error(
      'OpenBot cloud model requires OPENBOT_INTEGRATIONS_BASE_URL and OPENBOT_INTEGRATIONS_TOKEN.',
    );
  }

  return cloudOpenai.chat(modelId);
}

export function resolveModel(modelString: string, agentId?: string): LanguageModel {
  const [provider, ...rest] = modelString.split('/');
  const modelId = rest.join('/');
  if (!modelId) {
    throw new Error(`Invalid model string: "${modelString}". Expected "provider/model-id".`);
  }

  switch (provider) {
    case 'openbot':
      return resolveOpenbotModel(modelId, agentId);
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
