import { loadConfig } from "./config.js";
import { FALLBACK_MODELS } from "./model-defaults.js";

export interface ModelCatalogItem {
  id: string;
  label: string;
}

export type ModelProvider = "openai" | "anthropic";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedCatalog: ModelCatalogItem[] | null = null;
let cachedAt = 0;
let cachedFingerprint = "";

function keyFingerprint(value?: string): string {
  if (!value) return "none";
  const trimmed = value.trim();
  if (!trimmed) return "none";
  return `${trimmed.slice(0, 4)}:${trimmed.length}`;
}

function buildFingerprint(input: {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  model?: string;
}): string {
  return [
    `openai=${keyFingerprint(input.openaiApiKey)}`,
    `anthropic=${keyFingerprint(input.anthropicApiKey)}`,
    `model=${input.model ?? ""}`,
  ].join("|");
}

function titleCaseModel(raw: string): string {
  return raw
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function toProviderModel(provider: ModelProvider, modelId: string): ModelCatalogItem {
  const id = `${provider}/${modelId}`;
  const providerLabel = provider === "openai" ? "OpenAI" : "Anthropic";
  return { id, label: `${providerLabel} ${titleCaseModel(modelId)}` };
}

function dedupeModels(models: ModelCatalogItem[]): ModelCatalogItem[] {
  const seen = new Set<string>();
  const deduped: ModelCatalogItem[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    deduped.push(model);
  }
  return deduped;
}

function sortModels(models: ModelCatalogItem[]): ModelCatalogItem[] {
  return [...models].sort((a, b) => a.id.localeCompare(b.id));
}

function keepLikelyOpenAIChatModel(modelId: string): boolean {
  return /^(gpt|o[1-9]|chatgpt)/.test(modelId);
}

async function fetchOpenAIModels(apiKey: string): Promise<ModelCatalogItem[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    throw new Error(`OpenAI models request failed (${res.status})`);
  }

  const data = await res.json() as { data?: Array<{ id?: string }> };
  const models = (data.data ?? [])
    .map((m) => (typeof m.id === "string" ? m.id : ""))
    .filter((id) => !!id && keepLikelyOpenAIChatModel(id))
    .map((id) => toProviderModel("openai", id));

  return sortModels(dedupeModels(models));
}

async function fetchAnthropicModels(apiKey: string): Promise<ModelCatalogItem[]> {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });

  if (!res.ok) {
    throw new Error(`Anthropic models request failed (${res.status})`);
  }

  const data = await res.json() as { data?: Array<{ id?: string; display_name?: string }> };
  const models = (data.data ?? [])
    .map((m) => {
      const modelId = typeof m.id === "string" ? m.id : "";
      if (!modelId) return null;
      const label = typeof m.display_name === "string" && m.display_name.trim()
        ? m.display_name.trim()
        : toProviderModel("anthropic", modelId).label;
      return { id: `anthropic/${modelId}`, label };
    })
    .filter((m): m is ModelCatalogItem => !!m);

  return sortModels(dedupeModels(models));
}

export async function fetchProviderModels(
  provider: ModelProvider,
  apiKey: string
): Promise<ModelCatalogItem[]> {
  if (provider === "openai") {
    return fetchOpenAIModels(apiKey);
  }
  return fetchAnthropicModels(apiKey);
}

export async function getModelCatalog(forceRefresh = false): Promise<ModelCatalogItem[]> {
  const cfg = loadConfig();
  const openaiApiKey = cfg.openaiApiKey || process.env.OPENAI_API_KEY;
  const anthropicApiKey = cfg.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  const now = Date.now();
  const fingerprint = buildFingerprint({
    openaiApiKey,
    anthropicApiKey,
    model: cfg.model,
  });

  if (
    !forceRefresh &&
    cachedCatalog &&
    now - cachedAt < CACHE_TTL_MS &&
    cachedFingerprint === fingerprint
  ) {
    return cachedCatalog;
  }

  const providerFetches: Promise<ModelCatalogItem[]>[] = [];

  if (openaiApiKey) {
    providerFetches.push(fetchOpenAIModels(openaiApiKey));
  }
  if (anthropicApiKey) {
    providerFetches.push(fetchAnthropicModels(anthropicApiKey));
  }

  const results = await Promise.allSettled(providerFetches);
  const fetched = results
    .filter((r): r is PromiseFulfilledResult<ModelCatalogItem[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);

  const merged = dedupeModels([...fetched, ...FALLBACK_MODELS]);
  if (cfg.model && !merged.some((m) => m.id === cfg.model)) {
    merged.push({ id: cfg.model, label: cfg.model });
  }

  const catalog = sortModels(merged);
  cachedCatalog = catalog;
  cachedAt = now;
  cachedFingerprint = fingerprint;
  return catalog;
}
