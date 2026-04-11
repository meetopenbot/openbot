import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import matter from 'gray-matter';
import { LanguageModel } from 'ai';
import { MelonyPlugin } from 'melony';
import { z } from 'zod';
import { PluginRegistry, ToolPluginRegistryEntry } from './plugin-registry.js';
import { RuntimeRegistry } from './runtime-registry.js';
import { llmOrchestratorPlugin } from '../plugins/orchestrator.js';
import { createModel } from '../services/models.js';
import { resolvePath, DEFAULT_AGENT_MD } from '../app/config.js';
import { ensurePluginReady, getPluginMetadata } from './plugin-loader.js';
import { fileExists, findIndexFile, toTitleCaseFromSlug } from './loader-utils.js';

function resolveConfigPaths(config: any): any {
  if (typeof config === 'string') return resolvePath(config);
  if (Array.isArray(config)) return config.map(resolveConfigPaths);
  if (config !== null && typeof config === 'object') {
    const resolved: any = {};
    for (const [key, value] of Object.entries(config)) {
      resolved[key] = resolveConfigPaths(value);
    }
    return resolved;
  }
  return config;
}

function jsonToZod(schema: any): z.ZodType<any> {
  if (typeof schema === 'string') {
    if (schema === 'string') return z.string();
    if (schema === 'number') return z.number();
    if (schema === 'boolean') return z.boolean();
  }
  if (Array.isArray(schema)) {
    if (schema.length === 1) return z.array(jsonToZod(schema[0]));
    return z.array(z.any());
  }
  if (typeof schema === 'object' && schema !== null) {
    const shape: any = {};
    for (const [key, value] of Object.entries(schema)) {
      shape[key] = jsonToZod(value);
    }
    return z.object(shape);
  }
  return z.any();
}

export interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  image?: string;
  runtime?: string | { name: string; config?: any };
  plugins: (string | { name: string; config?: any })[];
  instructions: string;
  subscribe?: string[];
  outputSchema?: any;
}

export interface ListedAgent {
  id: string;
  name: string;
  description: string;
  type: 'agent';
  folder: string;
  /** From AGENT.md frontmatter when present */
  image?: string;
}

export async function readAgentConfig(agentDir: string): Promise<AgentConfig> {
  const mdPath = path.join(agentDir, 'AGENT.md');

  let mdContent = '';
  try {
    mdContent = await fs.readFile(mdPath, 'utf-8');
  } catch {
    mdContent = DEFAULT_AGENT_MD;
  }

  const parsed = matter(mdContent);
  const config = (parsed.data || {}) as Partial<AgentConfig>;

  return {
    name: typeof config.name === 'string' ? config.name : '',
    description: typeof config.description === 'string' ? config.description : '',
    model: config.model,
    image: config.image,
    runtime: config.runtime || (config as any).base,
    plugins: config.plugins || [],
    instructions: parsed.content.trim() || '',
    subscribe: config.subscribe,
    outputSchema: config.outputSchema,
  };
}

export async function listAgents(dir: string): Promise<ListedAgent[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const listed: ListedAgent[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) {
      continue;
    }

    const agentDir = path.join(dir, entry.name);
    const hasAgentMd = await fileExists(path.join(agentDir, 'AGENT.md'));
    if (!hasAgentMd) continue;

    const meta = await getPluginMetadata(agentDir);
    let name = meta.name || entry.name;
    let description = meta.description || 'No description';
    let image: string | undefined;

    try {
      const agentConfig = await readAgentConfig(agentDir);
      if (agentConfig.name?.trim()) name = agentConfig.name.trim();
      if (agentConfig.description?.trim()) description = agentConfig.description.trim();
      if (typeof agentConfig.image === 'string' && agentConfig.image.trim()) {
        image = agentConfig.image.trim();
      }
    } catch {
      // Keep package/default metadata fallback
    }

    listed.push({
      id: entry.name,
      name,
      description,
      type: 'agent',
      folder: agentDir,
      image,
    });
  }

  return listed;
}

function composeAgentFromConfig(
  config: AgentConfig,
  toolRegistry: PluginRegistry,
  mainRegistry: RuntimeRegistry,
  model: LanguageModel,
  resolvedModelId: string,
  resolvedBaseDir: string,
): { plugin: MelonyPlugin<any, any>; toolDefinitions: Record<string, any> } {
  const allToolDefinitions: Record<string, any> = {};
  const pluginFactories: { plugin: any; config: any }[] = [];

  for (const pluginItem of config.plugins) {
    const isString = typeof pluginItem === 'string';
    const pluginName = isString ? pluginItem : pluginItem.name;
    const pluginConfig = isString ? {} : pluginItem.config || {};
    const resolvedConfig = resolveConfigPaths(pluginConfig);

    const entry = toolRegistry.get(pluginName);
    if (!entry) {
      console.warn(`[plugins] "${config.name}": tool "${pluginName}" not found — skipping`);
      continue;
    }

    pluginFactories.push({ plugin: entry.plugin, config: resolvedConfig });
    Object.assign(allToolDefinitions, entry.toolDefinitions);
  }

  const plugin: MelonyPlugin<any, any> = (builder) => {
    for (const { plugin: toolPlugin, config: resolvedConfig } of pluginFactories) {
      builder.use(toolPlugin({ ...resolvedConfig, model }));
    }

    const runtimeInput = config.runtime || 'llm';
    const isRuntimeString = typeof runtimeInput === 'string';
    const runtimeName = isRuntimeString ? runtimeInput : runtimeInput.name;
    const runtimeConfig = isRuntimeString ? {} : runtimeInput.config || {};
    const resolvedRuntimeConfig = resolveConfigPaths(runtimeConfig);

    if (runtimeName === 'llm') {
      builder.use(
        llmOrchestratorPlugin({
          model,
          resolvedModelId,
          resolvedBaseDir,
          registry: mainRegistry,
          system: config.instructions,
          toolDefinitions: allToolDefinitions,
          outputSchema: config.outputSchema ? jsonToZod(config.outputSchema) : undefined,
        }),
      );
    } else {
      const runtimeEntry = toolRegistry.get(runtimeName);
      if (!runtimeEntry) {
        console.error(
          `[plugins] "${config.name}": runtime plugin "${runtimeName}" not found or invalid. Falling back to default LLM brain.`,
        );
        builder.use(
          llmOrchestratorPlugin({
            model,
            resolvedModelId,
            resolvedBaseDir,
            registry: mainRegistry,
            system: config.instructions,
            toolDefinitions: allToolDefinitions,
          }),
        );
      } else {
        builder.use(
          runtimeEntry.plugin({
            ...resolvedRuntimeConfig,
            model,
            instructions: config.instructions,
            toolDefinitions: allToolDefinitions,
            outputSchema: config.outputSchema ? jsonToZod(config.outputSchema) : undefined,
          }),
        );
      }
    }
  };

  return { plugin, toolDefinitions: allToolDefinitions };
}

async function loadToolPluginsFromDir(dir: string): Promise<ToolPluginRegistryEntry[]> {
  const plugins: ToolPluginRegistryEntry[] = [];
  if (!(await fileExists(dir))) return plugins;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) {
        continue;
      }

      const pluginDir = path.join(dir, entry.name);
      await ensurePluginReady(pluginDir);

      const indexPath = await findIndexFile(pluginDir);
      if (!indexPath) continue;

      try {
        const module = await import(pathToFileURL(indexPath).href + `?update=${Date.now()}`);
        const entryData = module.plugin || module.default || module.entry;
        if (entryData && typeof entryData.factory === 'function') {
          plugins.push({
            id: entry.name,
            name: entryData.name || entry.name,
            description: entryData.description || `Tool plugin ${entry.name}`,
            plugin: entryData.factory,
            toolDefinitions: entryData.toolDefinitions || {},
          });
        }
      } catch (err) {
        console.error(`[plugins] Failed to load tool plugin "${entry.name}":`, err);
      }
    }
  } catch (err) {
    console.warn(`[plugins] Error reading directory ${dir}:`, err);
  }

  return plugins;
}

export async function discoverAgents(
  agentsDir: string,
  registry: RuntimeRegistry,
  defaultModel: LanguageModel,
  resolvedModelId: string,
  resolvedBaseDir: string,
  options?: { openaiApiKey?: string; anthropicApiKey?: string },
): Promise<void> {
  try {
    await fs.mkdir(agentsDir, { recursive: true });
  } catch {
    /* best effort */
  }

  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(agentsDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const folderName = entry.name;
    const agentDir = path.join(agentsDir, folderName);

    try {
      const hasAgentMd = await fileExists(path.join(agentDir, 'AGENT.md'));
      if (!hasAgentMd) continue;

      const config = await readAgentConfig(agentDir);
      const meta = await getPluginMetadata(agentDir);
      const id = folderName;

      let resolvedName = config.name || meta.name;
      if (!resolvedName || /^Unnamed\s+(Plugin|Tool|Agent)$/i.test(resolvedName)) {
        resolvedName = toTitleCaseFromSlug(folderName);
      }
      const resolvedDescription = config.description || meta.description || 'No description';

      const agentModel = config.model
        ? createModel({ ...options, model: config.model })
        : defaultModel;

      const localPlugins = await loadToolPluginsFromDir(path.join(agentDir, 'plugins'));
      const scopedRegistry = new PluginRegistry();
      for (const p of registry.getTools()) scopedRegistry.register(p);
      for (const p of localPlugins) scopedRegistry.register(p);

      const { plugin, toolDefinitions } = composeAgentFromConfig(
        config,
        scopedRegistry,
        registry,
        agentModel as LanguageModel,
        resolvedModelId,
        resolvedBaseDir,
      );

      registry.registerAgent({
        id,
        name: resolvedName,
        description: resolvedDescription,
        plugin,
        capabilities: Object.fromEntries(
          Object.entries(toolDefinitions).map(([name, def]) => [name, (def as any).description]),
        ),
        subscribe: config.subscribe,
        folder: agentDir,
      });
      console.log(
        `[agents] Loaded agent: ${id} (${resolvedName}) — ${resolvedDescription.slice(0, 20)}${config.model ? ` (model: ${config.model})` : ''}`,
      );
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.warn(`[agents] Error loading "${folderName}":`, err);
      }
    }
  }
}

export async function registerOpenBotRootDefaultAgent(
  registry: RuntimeRegistry,
  resolvedBaseDir: string,
  defaultModel: LanguageModel,
  resolvedModelId: string,
  options?: { openaiApiKey?: string; anthropicApiKey?: string },
): Promise<void> {
  if (registry.getAgents().some((a) => a.id === 'default')) {
    return;
  }

  const config = await readAgentConfig(resolvedBaseDir);
  const meta = await getPluginMetadata(resolvedBaseDir);

  let resolvedName = config.name || meta.name;
  if (!resolvedName || /^Unnamed\s+(Plugin|Tool|Agent)$/i.test(resolvedName)) {
    resolvedName = 'OpenBot';
  }
  const resolvedDescription = config.description || meta.description || 'The main orchestrator';

  const agentModel = config.model
    ? createModel({ ...options, model: config.model })
    : defaultModel;

  const scopedRegistry = new PluginRegistry();
  for (const p of registry.getTools()) scopedRegistry.register(p);

  const { plugin, toolDefinitions } = composeAgentFromConfig(
    config,
    scopedRegistry,
    registry,
    agentModel as LanguageModel,
    resolvedModelId,
    resolvedBaseDir,
  );

  registry.registerAgent({
    id: 'default',
    name: resolvedName,
    description: resolvedDescription,
    plugin,
    capabilities: Object.fromEntries(
      Object.entries(toolDefinitions).map(([name, def]) => [name, (def as any).description]),
    ),
    subscribe: config.subscribe,
    folder: resolvedBaseDir,
  });
  console.log(
    `[agents] Loaded default agent from root AGENT.md: default (${resolvedName}) — ${resolvedDescription}${config.model ? ` (model: ${config.model})` : ''}`,
  );
}
