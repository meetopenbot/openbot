import { installPluginFromSource } from "./installers.js";

type SourceType = "github" | "npm";

export interface MarketplaceSource {
  type: SourceType;
  value: string;
}

export interface MarketplaceItem {
  id: string;
  name: string;
  description: string;
  source: MarketplaceSource;
  tags?: string[];
  image?: string;
}

export interface MarketplaceRegistry {
  version: number;
  plugins: MarketplaceItem[];
}

const DEFAULT_MARKETPLACE_REGISTRY_URL =
  "https://raw.githubusercontent.com/meetopenbot/openbot-registry/main/registry.json";
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedRegistry: MarketplaceRegistry | null = null;
let cacheExpiresAt = 0;

function normalizeSource(source: unknown): MarketplaceSource {
  if (!source || typeof source !== "object") {
    throw new Error("invalid source");
  }
  const value = source as { type?: unknown; value?: unknown };
  if ((value.type !== "github" && value.type !== "npm") || typeof value.value !== "string" || !value.value.trim()) {
    throw new Error("invalid source");
  }
  return { type: value.type, value: value.value.trim() };
}

function normalizeItem(item: unknown): MarketplaceItem {
  if (!item || typeof item !== "object") throw new Error("invalid item");
  const value = item as {
    id?: unknown;
    name?: unknown;
    description?: unknown;
    source?: unknown;
    tags?: unknown;
    image?: unknown;
  };
  if (typeof value.id !== "string" || !value.id.trim()) throw new Error("invalid item id");
  if (typeof value.name !== "string" || !value.name.trim()) throw new Error("invalid item name");
  if (typeof value.description !== "string") throw new Error("invalid item description");
  const tags = Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string") : undefined;
  return {
    id: value.id.trim(),
    name: value.name.trim(),
    description: value.description,
    source: normalizeSource(value.source),
    tags,
    image: typeof value.image === "string" ? value.image.trim() : undefined,
  };
}

function normalizeRegistry(value: unknown): MarketplaceRegistry {
  if (!value || typeof value !== "object") throw new Error("invalid registry");
  const raw = value as { version?: unknown; plugins?: unknown };
  if (typeof raw.version !== "number") throw new Error("invalid version");
  const plugins = Array.isArray(raw.plugins) ? raw.plugins.map(normalizeItem) : [];
  return { version: raw.version, plugins };
}

export async function getMarketplaceRegistry(forceRefresh = false): Promise<MarketplaceRegistry> {
  const now = Date.now();
  if (!forceRefresh && cachedRegistry && now < cacheExpiresAt) {
    return cachedRegistry;
  }

  const registryUrl = process.env.OPENBOT_MARKETPLACE_REGISTRY_URL || DEFAULT_MARKETPLACE_REGISTRY_URL;
  const response = await fetch(registryUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch marketplace registry (${response.status})`);
  }

  const json = await response.json();
  const normalized = normalizeRegistry(json);
  cachedRegistry = normalized;
  cacheExpiresAt = now + CACHE_TTL_MS;
  return normalized;
}

export async function installMarketplacePlugin(pluginId: string) {
  const registry = await getMarketplaceRegistry(true);
  const plugin = registry.plugins.find((entry) => entry.id === pluginId);
  if (!plugin) throw new Error(`Plugin "${pluginId}" was not found in marketplace`);
  const installedName = await installPluginFromSource(plugin.source, { id: plugin.id });
  return { installedName, plugin };
}
