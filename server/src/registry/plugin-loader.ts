import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { MelonyPlugin } from 'melony';
import { LanguageModel } from 'ai';
import matter from 'gray-matter';
import { z } from 'zod';
import { PluginRegistry, ToolPluginRegistryEntry } from './plugin-registry.js';
import { llmOrchestratorPlugin } from '../plugins/orchestrator.js';
import { createModel } from '../services/models.js';
import { resolvePath, DEFAULT_AGENT_MD } from '../app/config.js';

// ── Helpers ──────────────────────────────────────────────────────────

function toTitleCaseFromSlug(value: string): string {
  return (
    value
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || 'Agent'
  );
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function findIndexFile(dir: string): Promise<string | undefined> {
  for (const file of ['dist/index.js', 'index.js', 'index.ts']) {
    if (await fileExists(path.join(dir, file))) {
      return path.join(dir, file);
    }
  }
  return undefined;
}

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

// ── Metadata ─────────────────────────────────────────────────────────

export async function getPluginMetadata(
  pluginDir: string,
): Promise<{ name: string; description: string; version: string }> {
  const pkgPath = path.join(pluginDir, 'package.json');
  const hasPackageJson = await fileExists(pkgPath);

  let name = 'Unnamed Plugin';
  let description = 'No description';
  let version = '0.0.0';

  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
      name = pkg.name?.split('/').pop() || name;
      description = pkg.description || description;
      version = pkg.version || version;
    } catch {
      /* fallback to defaults */
    }
  }

  return { name, description, version };
}

export async function ensurePluginReady(pluginDir: string) {
  try {
    const pkgPath = path.join(pluginDir, 'package.json');
    if (!(await fileExists(pkgPath))) return;

    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    const nodeModulesPath = path.join(pluginDir, 'node_modules');

    if (!(await fileExists(nodeModulesPath))) {
      console.log(`[plugins] Installing dependencies for ${path.basename(pluginDir)}...`);
      execSync('npm install', { cwd: pluginDir, stdio: 'inherit' });
    }

    const distPath = path.join(pluginDir, 'dist');
    if (!(await fileExists(distPath)) && pkg.scripts?.build) {
      console.log(`[plugins] Building ${path.basename(pluginDir)}...`);
      execSync('npm run build', { cwd: pluginDir, stdio: 'inherit' });
    }
  } catch (err) {
    console.error(`[plugins] Failed to prepare plugin in ${pluginDir}:`, err);
  }
}

export interface ListedPlugin {
  id: string;
  name: string;
  description: string;
  type: 'tool' | 'agent';
  folder: string;
}

export async function listPlugins(dir: string): Promise<ListedPlugin[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const listed: ListedPlugin[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) {
      continue;
    }

    const pluginDir = path.join(dir, entry.name);
    const hasAgentMd = await fileExists(path.join(pluginDir, 'AGENT.md'));
    const hasIndex = !!(await findIndexFile(pluginDir));
    const hasPkg = await fileExists(path.join(pluginDir, 'package.json'));

    if (!hasAgentMd && !hasIndex && !hasPkg) continue;

    const type: 'tool' | 'agent' = hasAgentMd ? 'agent' : 'tool';
    const meta = await getPluginMetadata(pluginDir);
    let name = meta.name || entry.name;
    let description = meta.description || 'No description';

    if (hasAgentMd) {
      try {
        const agentConfig = await readAgentConfig(pluginDir);
        if (agentConfig.name?.trim()) name = agentConfig.name.trim();
        if (agentConfig.description?.trim()) description = agentConfig.description.trim();
      } catch {
        // Keep package/default metadata fallback
      }
    }

    listed.push({
      id: entry.name,
      name,
      description,
      type,
      folder: pluginDir,
    });
  }

  return listed;
}

// ── AGENT.md Config ──────────────────────────────────────────────────

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

// read agent config from AGENT.md
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

// ── Agent composition (declarative AGENT.md agents) ──────────────────

function composeAgentFromConfig(
  config: AgentConfig,
  toolRegistry: PluginRegistry,
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
    if (!entry || entry.type !== 'tool') {
      console.warn(`[plugins] "${config.name}": tool "${pluginName}" not found — skipping`);
      continue;
    }

    pluginFactories.push({ plugin: entry.plugin, config: resolvedConfig });
    Object.assign(allToolDefinitions, entry.toolDefinitions);
  }

  const plugin: MelonyPlugin<any, any> = (builder) => {
    // 1. Initialize all regular tool plugins
    for (const { plugin: toolPlugin, config: resolvedConfig } of pluginFactories) {
      builder.use(toolPlugin({ ...resolvedConfig, model }));
    }

    // 2. Resolve the Brain (Runtime Plugin)
    const runtimeInput = config.runtime || 'llm';
    const isRuntimeString = typeof runtimeInput === 'string';
    const runtimeName = isRuntimeString ? runtimeInput : runtimeInput.name;
    const runtimeConfig = isRuntimeString ? {} : runtimeInput.config || {};
    const resolvedRuntimeConfig = resolveConfigPaths(runtimeConfig);

    if (runtimeName === 'llm') {
      // Default built-in brain with orchestration
      builder.use(
        llmOrchestratorPlugin({
          model,
          resolvedModelId,
          resolvedBaseDir,
          registry: toolRegistry,
          system: config.instructions,
          toolDefinitions: allToolDefinitions,
          outputSchema: config.outputSchema ? jsonToZod(config.outputSchema) : undefined,
        }),
      );
    } else {
      // Custom autonomous brain (e.g. codex)
      const runtimeEntry = toolRegistry.get(runtimeName);

      if (!runtimeEntry || runtimeEntry.type !== 'tool') {
        console.error(
          `[plugins] "${config.name}": runtime plugin "${runtimeName}" not found or invalid. Falling back to default LLM brain.`,
        );
        builder.use(
          llmOrchestratorPlugin({
            model,
            resolvedModelId,
            resolvedBaseDir,
            registry: toolRegistry,
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

// ── Load tool plugins from a subdirectory ─

async function loadToolPluginsFromDir(dir: string): Promise<ToolPluginRegistryEntry[]> {
  const plugins: ToolPluginRegistryEntry[] = [];
  if (!(await fileExists(dir))) return plugins;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_'))
        continue;

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
            type: 'tool' as const,
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

// ── Main unified discovery ───────────────────────────────────────────

export async function discoverPlugins(
  dir: string,
  registry: PluginRegistry,
  defaultModel: LanguageModel,
  resolvedModelId: string,
  resolvedBaseDir: string,
  options?: { openaiApiKey?: string; anthropicApiKey?: string },
): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    /* best effort */
  }

  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const folderName = entry.name;
    const pluginDir = path.join(dir, folderName);

    try {
      const hasAgentMd = await fileExists(path.join(pluginDir, 'AGENT.md'));

      if (hasAgentMd) {
        // ── Agent Plugin (Declarative) ──────────────────────────────────
        const config = await readAgentConfig(pluginDir);
        const meta = await getPluginMetadata(pluginDir);
        const id = folderName;

        let resolvedName = config.name || meta.name;
        if (!resolvedName || /^Unnamed\s+(Plugin|Tool|Agent)$/i.test(resolvedName)) {
          resolvedName = toTitleCaseFromSlug(folderName);
        }
        const resolvedDescription = config.description || meta.description || 'No description';

        const agentModel = config.model
          ? createModel({ ...options, model: config.model })
          : defaultModel;

        const localPlugins = await loadToolPluginsFromDir(path.join(pluginDir, 'plugins'));
        const scopedRegistry = new PluginRegistry();
        for (const p of registry.getTools()) scopedRegistry.register(p);
        for (const p of localPlugins) scopedRegistry.register(p);

        const { plugin, toolDefinitions } = composeAgentFromConfig(
          config,
          scopedRegistry,
          agentModel as LanguageModel,
          resolvedModelId,
          resolvedBaseDir,
        );

        registry.register({
          id,
          name: resolvedName,
          description: resolvedDescription,
          type: 'agent',
          plugin,
          capabilities: Object.fromEntries(
            Object.entries(toolDefinitions).map(([name, def]) => [name, (def as any).description]),
          ),
          subscribe: config.subscribe,
          folder: pluginDir,
        });
        console.log(
          `[plugins] Loaded agent: ${id} (${resolvedName}) — ${resolvedDescription}${config.model ? ` (model: ${config.model})` : ''}`,
        );
      } else {
        // ── Tool Plugin (TS/JS) ────────────────────────────────────────
        const indexPath = await findIndexFile(pluginDir);
        if (!indexPath) continue;

        await ensurePluginReady(pluginDir);
        const module = await import(pathToFileURL(indexPath).href + `?update=${Date.now()}`);
        const entryData = module.plugin || module.default || module.entry;

        if (entryData && typeof entryData.factory === 'function') {
          const meta = await getPluginMetadata(pluginDir);
          const id = folderName;
          let name = entryData.name || meta.name;
          if (!name || /^Unnamed\s+(Plugin|Tool|Agent)$/i.test(name)) {
            name = toTitleCaseFromSlug(folderName);
          }
          const pluginEntry: ToolPluginRegistryEntry = {
            id,
            name,
            description: entryData.description || meta.description || 'Tool plugin',
            type: 'tool',
            plugin: entryData.factory,
            toolDefinitions: entryData.toolDefinitions || {},
            folder: pluginDir,
          };
          registry.register(pluginEntry);
          console.log(`[plugins] Loaded tool: ${id} (${pluginEntry.name})`);
        }
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.warn(`[plugins] Error loading "${folderName}":`, err);
      }
    }
  }
}

/**
 * Registers the workspace root AGENT.md (~/.openbot/AGENT.md) as agent id `default`.
 * The REST API always exposes this agent, and channel managers often use id `default`;
 * without this entry, `agentRuntimes.get("default")` is undefined and channel messages noop.
 */
export async function registerOpenBotRootDefaultAgent(
  registry: PluginRegistry,
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

  // Global ~/.openbot/plugins are already on `registry`; do not load them again as "local" (would duplicate ids).
  const scopedRegistry = new PluginRegistry();
  for (const p of registry.getTools()) scopedRegistry.register(p);

  const { plugin, toolDefinitions } = composeAgentFromConfig(
    config,
    scopedRegistry,
    agentModel as LanguageModel,
    resolvedModelId,
    resolvedBaseDir,
  );

  registry.register({
    id: 'default',
    name: resolvedName,
    description: resolvedDescription,
    type: 'agent',
    plugin,
    capabilities: Object.fromEntries(
      Object.entries(toolDefinitions).map(([name, def]) => [name, (def as any).description]),
    ),
    subscribe: config.subscribe,
    folder: resolvedBaseDir,
  });
  console.log(
    `[plugins] Loaded default agent from root AGENT.md: default (${resolvedName}) — ${resolvedDescription}${config.model ? ` (model: ${config.model})` : ''}`,
  );
}
