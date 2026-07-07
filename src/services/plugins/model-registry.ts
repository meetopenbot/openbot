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

const STATIC_PROVIDERS: RegistryProviderCatalog = {
  openai: {
    label: 'OpenAI',
    models: [
      {
        id: 'gpt-4o-mini',
        label: 'GPT-4o Mini',
        description: 'Fast, cost-effective model',
      },
      {
        id: 'gpt-4o',
        label: 'GPT-4o',
        description: 'Capable multimodal model',
      },
    ],
  },
  anthropic: {
    label: 'Anthropic',
    models: [
      {
        id: 'claude-3-5-sonnet-latest',
        label: 'Claude 3.5 Sonnet',
        description: 'Balanced performance',
      },
    ],
  },
  google: {
    label: 'Google',
    models: [
      {
        id: 'gemini-2.0-flash',
        label: 'Gemini 2.0 Flash',
        description: 'Fast Google model',
      },
    ],
  },
};

export async function resolveModelRegistry(): Promise<ModelRegistry> {
  return { providers: STATIC_PROVIDERS };
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
  return values.find((value) => value.startsWith('openai/')) ?? values[0];
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
    description: 'Model in provider/model-id format.',
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
