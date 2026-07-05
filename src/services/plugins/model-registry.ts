import {
  DEFAULT_MARKETPLACE_REGISTRY_URL,
  loadConfig,
} from '../../app/config.js';
import { isCloudMode } from '../../app/cloud-mode.js';
import type { ConfigSchema, PluginDescriptor } from './domain.js';

export type RegistryProviderCatalog = Record<
  string,
  {
    label: string;
    models: Array<{ id: string; label: string; description: string }>;
  }
>;

export type ModelRegistry = {
  providers?: RegistryProviderCatalog;
};

export type RegistryModelOption = {
  value: string;
  label: string;
  description?: string;
  provider: string;
};

let cachedRegistry: ModelRegistry | null = null;
let cacheUrl: string | null = null;

function getRegistryUrl(): string {
  const { marketplaceRegistryUrl } = loadConfig();
  return marketplaceRegistryUrl?.trim() || DEFAULT_MARKETPLACE_REGISTRY_URL;
}

export async function resolveModelRegistry(): Promise<ModelRegistry> {
  const url = getRegistryUrl();
  if (cachedRegistry && cacheUrl === url) return cachedRegistry;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`Registry HTTP ${res.status} ${res.statusText}`);
    }
    cachedRegistry = (await res.json()) as ModelRegistry;
    cacheUrl = url;
    return cachedRegistry;
  } catch (err) {
    console.warn(
      '[model-registry] fetch failed:',
      err instanceof Error ? err.message : err,
    );
    return { providers: {} };
  }
}

export function listModelOptionsFromRegistry(registry: ModelRegistry): RegistryModelOption[] {
  const providers = registry.providers ?? {};
  const out: RegistryModelOption[] = [];

  for (const [providerId, provider] of Object.entries(providers)) {
    for (const model of provider.models ?? []) {
      out.push({
        value: `${providerId}/${model.id}`,
        label: `${provider.label} — ${model.label}`,
        description: model.description,
        provider: providerId,
      });
    }
  }

  return out;
}

export async function listRegistryModelOptions(): Promise<RegistryModelOption[]> {
  const registry = await resolveModelRegistry();
  return listModelOptionsFromRegistry(registry);
}

export function listApiKeyProvidersFromRegistry(
  registry: ModelRegistry,
): Array<{ id: string; label: string }> {
  const providers = registry.providers ?? {};
  return Object.entries(providers).map(([id, provider]) => ({
    id,
    label: provider.label,
  }));
}

function pickDefaultModelValue(options: RegistryModelOption[]): string | undefined {
  if (options.length === 0) return undefined;
  const values = options.map((option) => option.value);
  const preferred = isCloudMode()
    ? values.find((value) => value.startsWith('openbot/'))
    : values.find((value) => value.startsWith('openai/'));
  return preferred ?? values[0];
}

export function enrichOpenbotPluginDescriptor(
  descriptor: PluginDescriptor,
  modelOptions: RegistryModelOption[],
): PluginDescriptor {
  if (descriptor.id !== 'openbot' || !descriptor.configSchema) return descriptor;

  const modelProperty = descriptor.configSchema.properties.model;
  if (!modelProperty) return descriptor;

  const values = modelOptions.map((option) => option.value);
  const staticDefault =
    typeof modelProperty.default === 'string' ? modelProperty.default : undefined;
  const defaultModel =
    staticDefault && values.includes(staticDefault)
      ? staticDefault
      : pickDefaultModelValue(modelOptions) ?? staticDefault;

  const nextModelProperty: ConfigSchema['properties'][string] = {
    ...modelProperty,
    description: 'Model from the hosted marketplace registry.',
  };

  if (values.length > 0) {
    nextModelProperty.enum = values;
    nextModelProperty.options = modelOptions.map((option) => ({
      label: option.label,
      value: option.value,
      description: option.description,
    }));
  }

  if (defaultModel) {
    nextModelProperty.default = defaultModel;
  }

  return {
    ...descriptor,
    configSchema: {
      ...descriptor.configSchema,
      properties: {
        ...descriptor.configSchema.properties,
        model: nextModelProperty,
      },
    },
  };
}
