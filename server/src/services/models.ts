import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { loadConfig } from "../app/config.js";
import { DEFAULT_MODEL_ID } from "./model-defaults.js";

type Provider = "openai" | "anthropic";

interface ParsedModel {
  provider: Provider;
  modelId: string;
}

/**
 * Parse model string to extract provider and model ID
 * Supports formats: "provider/model" or just "model" (defaults to openai)
 */
export function parseModelString(modelString: string): ParsedModel {
  // Check for provider/model format
  if (modelString.includes("/")) {
    const [provider, modelId] = modelString.split("/");
    if (provider === "openai" || provider === "anthropic") {
      return { provider: provider as Provider, modelId };
    }
  }

  // Auto-detect provider based on model name
  if (modelString.startsWith("claude") || modelString.startsWith("claude-")) {
    return { provider: "anthropic", modelId: modelString };
  }

  // Default to OpenAI
  return { provider: "openai", modelId: modelString };
}

export function createModel(options?: {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  model?: string;
}) {
  const config = loadConfig();

  const openaiKey = options?.openaiApiKey || config.openaiApiKey || process.env.OPENAI_API_KEY;
  const anthropicKey = options?.anthropicApiKey || config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;

  if (openaiKey) {
    process.env.OPENAI_API_KEY = openaiKey;
  }

  if (anthropicKey) {
    process.env.ANTHROPIC_API_KEY = anthropicKey;
  }

  const { provider, modelId } = parseModelString(options?.model || config.model || DEFAULT_MODEL_ID);

  if (provider === "anthropic") {
    if (!anthropicKey) {
      console.warn("Warning: Anthropic model selected but ANTHROPIC_API_KEY is not set");
    }
    return anthropic(modelId);
  } else {
    if (!openaiKey) {
      console.warn("Warning: OpenAI model selected but OPENAI_API_KEY is not set");
    }
    return openai(modelId);
  }
}
