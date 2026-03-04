import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { MelonyPlugin } from "melony";
import { LanguageModel } from "ai";
import matter from "gray-matter";
import { PluginRegistry, ToolPluginRegistryEntry } from "./plugin-registry.js";
import { llmPlugin } from "../plugins/llm/index.js";
import { createModel } from "../models.js";
import { resolvePath, DEFAULT_AGENT_MD } from "../config.js";
import type { ChatState, ChatEvent } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function toTitleCaseFromSlug(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Agent";
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function findIndexFile(dir: string): Promise<string | undefined> {
  for (const file of ["dist/index.js", "index.js", "index.ts"]) {
    if (await fileExists(path.join(dir, file))) {
      return path.join(dir, file);
    }
  }
  return undefined;
}

function resolveConfigPaths(config: any): any {
  if (typeof config === "string") return resolvePath(config);
  if (Array.isArray(config)) return config.map(resolveConfigPaths);
  if (config !== null && typeof config === "object") {
    const resolved: any = {};
    for (const [key, value] of Object.entries(config)) {
      resolved[key] = resolveConfigPaths(value);
    }
    return resolved;
  }
  return config;
}

// ── Metadata ─────────────────────────────────────────────────────────

export async function getPluginMetadata(pluginDir: string): Promise<{ name: string; description: string; version: string }> {
  const pkgPath = path.join(pluginDir, "package.json");
  const hasPackageJson = await fileExists(pkgPath);

  let name = "Unnamed Plugin";
  let description = "No description";
  let version = "0.0.0";

  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
      name = (pkg.name?.split("/").pop()) || name;
      description = pkg.description || description;
      version = pkg.version || version;
    } catch { /* fallback to defaults */ }
  }

  return { name, description, version };
}

export async function ensurePluginReady(pluginDir: string) {
  try {
    const pkgPath = path.join(pluginDir, "package.json");
    if (!(await fileExists(pkgPath))) return;

    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
    const nodeModulesPath = path.join(pluginDir, "node_modules");

    if (!(await fileExists(nodeModulesPath))) {
      console.log(`[plugins] Installing dependencies for ${path.basename(pluginDir)}...`);
      execSync("npm install", { cwd: pluginDir, stdio: "inherit" });
    }

    const distPath = path.join(pluginDir, "dist");
    if (!(await fileExists(distPath)) && pkg.scripts?.build) {
      console.log(`[plugins] Building ${path.basename(pluginDir)}...`);
      execSync("npm run build", { cwd: pluginDir, stdio: "inherit" });
    }
  } catch (err) {
    console.error(`[plugins] Failed to prepare plugin in ${pluginDir}:`, err);
  }
}

// ── AGENT.md Config ──────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  image?: string;
  plugins: (string | { name: string; config?: any })[];
  instructions: string;
  subscribe?: string[];
}

export async function readAgentConfig(agentDir: string): Promise<AgentConfig> {
  const mdPath = path.join(agentDir, "AGENT.md");

  let mdContent = "";
  try {
    mdContent = await fs.readFile(mdPath, "utf-8");
  } catch {
    mdContent = DEFAULT_AGENT_MD;
  }

  const parsed = matter(mdContent);
  const config = (parsed.data || {}) as Partial<AgentConfig>;

  return {
    name: typeof config.name === "string" ? config.name : "",
    description: typeof config.description === "string" ? config.description : "",
    model: config.model,
    image: config.image,
    plugins: config.plugins || [],
    instructions: parsed.content.trim() || "",
    subscribe: config.subscribe,
  };
}

// ── Agent composition (declarative AGENT.md agents) ──────────────────

function composeAgentFromConfig(
  config: AgentConfig,
  toolRegistry: PluginRegistry,
  model: LanguageModel,
): { plugin: MelonyPlugin<any, any>; toolDefinitions: Record<string, any> } {
  const allToolDefinitions: Record<string, any> = {};
  const pluginFactories: { plugin: any; config: any }[] = [];

  for (const pluginItem of config.plugins) {
    const isString = typeof pluginItem === "string";
    const pluginName = isString ? pluginItem : pluginItem.name;
    const pluginConfig = isString ? {} : (pluginItem.config || {});
    const resolvedConfig = resolveConfigPaths(pluginConfig);

    const entry = toolRegistry.get(pluginName);
    if (!entry || entry.type !== "tool") {
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
    builder.use(llmPlugin({
      model,
      system: config.instructions,
      toolDefinitions: allToolDefinitions,
    }));
  };

  return { plugin, toolDefinitions: allToolDefinitions };
}

// ── TS Agent definition shape ────────────────────────────────────────

interface TSAgentDefinition {
  name?: string;
  description?: string;
  image?: string;
  factory: (options: { model: LanguageModel; [key: string]: any }) => MelonyPlugin<ChatState, ChatEvent>;
  capabilities?: Record<string, string>;
  subscribe?: string[];
}

// ── Load tool plugins from a subdirectory (used for agent-local tools) ─

async function loadToolPluginsFromDir(dir: string): Promise<ToolPluginRegistryEntry[]> {
  const plugins: ToolPluginRegistryEntry[] = [];
  if (!(await fileExists(dir))) return plugins;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue;

      const pluginDir = path.join(dir, entry.name);
      await ensurePluginReady(pluginDir);

      const indexPath = await findIndexFile(pluginDir);
      if (!indexPath) continue;

      try {
        const module = await import(pathToFileURL(indexPath).href + `?update=${Date.now()}`);
        const entryData = module.plugin || module.default || module.entry;

        if (entryData && typeof entryData.factory === "function") {
          plugins.push({
            name: entryData.name || entry.name,
            description: entryData.description || `Tool plugin ${entry.name}`,
            type: "tool" as const,
            plugin: entryData.factory,
            toolDefinitions: entryData.toolDefinitions || {},
          });
        } else {
          console.warn(`[plugins] "${entry.name}" does not export a valid plugin entry (missing factory)`);
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

/**
 * Discover all plugins (tools + agents) from a directory.
 *
 * Pass 1: Load code plugins in folders without AGENT.md.
 *   - module.agent export → code-only agent
 *   - plugin/default/entry export → tool plugin
 * Pass 2: Load agent-type plugins (folders WITH AGENT.md).
 *   - AGENT.md only → declarative agent (auto-wrapped with llmPlugin)
 *   - AGENT.md + index.ts → TS agent (user controls logic, AGENT.md for UI editing)
 *
 * Discovered entries are registered directly into the provided registry.
 */
export async function discoverPlugins(
  dir: string,
  registry: PluginRegistry,
  defaultModel: LanguageModel,
  options?: { openaiApiKey?: string; anthropicApiKey?: string },
): Promise<void> {
  try { await fs.mkdir(dir, { recursive: true }); } catch { /* best effort */ }

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch { return; }

  // Classify each subdirectory
  const codeDirs: string[] = [];
  const agentDirs: { dir: string; hasIndex: boolean }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue;

    const pluginDir = path.join(dir, entry.name);
    const hasAgentMd = await fileExists(path.join(pluginDir, "AGENT.md"));
    const hasIndex = !!(await findIndexFile(pluginDir));
    const hasPkg = await fileExists(path.join(pluginDir, "package.json"));

    if (hasAgentMd) {
      agentDirs.push({ dir: pluginDir, hasIndex: hasIndex || hasPkg });
    } else if (hasIndex || hasPkg) {
      codeDirs.push(pluginDir);
    }
  }

  // Pass 1: code-only agents and tool plugins
  for (const pluginDir of codeDirs) {
    await ensurePluginReady(pluginDir);
    const indexPath = await findIndexFile(pluginDir);
    if (!indexPath) continue;

    try {
      const module = await import(pathToFileURL(indexPath).href + `?update=${Date.now()}`);
      const codeAgentDef: TSAgentDefinition | undefined = module.agent;
      const entryData = module.plugin || module.default || module.entry;

      if (codeAgentDef && typeof codeAgentDef.factory === "function") {
        const meta = await getPluginMetadata(pluginDir);
        const folderName = path.basename(pluginDir);
        let name = codeAgentDef.name || meta.name;
        if (!name || /^Unnamed\s+(Plugin|Tool|Agent)$/i.test(name)) {
          name = toTitleCaseFromSlug(folderName);
        }
        const description = codeAgentDef.description || meta.description || "Code Agent";
        registry.register({
          name,
          description,
          type: "agent",
          plugin: codeAgentDef.factory({ ...options, model: defaultModel }),
          capabilities: codeAgentDef.capabilities,
          subscribe: codeAgentDef.subscribe,
          folder: pluginDir,
        });
        console.log(`[plugins] Loaded code-only agent: ${name} — ${description}`);
      } else if (entryData && typeof entryData.factory === "function") {
        const meta = await getPluginMetadata(pluginDir);
        const folderName = path.basename(pluginDir);
        let name = entryData.name || meta.name;
        if (!name || /^Unnamed\s+(Plugin|Tool|Agent)$/i.test(name)) {
          name = toTitleCaseFromSlug(folderName);
        }
        const pluginEntry: ToolPluginRegistryEntry = {
          name,
          description: entryData.description || meta.description || "Tool plugin",
          type: "tool",
          plugin: entryData.factory,
          toolDefinitions: entryData.toolDefinitions || {},
          folder: pluginDir,
        };
        registry.register(pluginEntry);
        console.log(`[plugins] Loaded tool: ${pluginEntry.name}`);
      } else {
        console.warn(`[plugins] "${path.basename(pluginDir)}" does not export a valid plugin (missing factory)`);
      }
    } catch (err) {
      console.error(`[plugins] Failed to load "${path.basename(pluginDir)}":`, err);
    }
  }

  // Pass 2: agent plugins
  for (const { dir: agentDir, hasIndex } of agentDirs) {
    const folderName = path.basename(agentDir);

    try {
      if (hasIndex) {
        // TS Agent — has AGENT.md + code. User controls logic; AGENT.md is for UI editing.
        await ensurePluginReady(agentDir);
        const indexPath = await findIndexFile(agentDir);
        if (!indexPath) continue;

        const module = await import(pathToFileURL(indexPath).href + `?update=${Date.now()}`);
        const definition: TSAgentDefinition = module.agent || module.plugin || module.default || module.entry;

        if (definition && typeof definition.factory === "function") {
          const config = await readAgentConfig(agentDir);
          const meta = await getPluginMetadata(agentDir);
          let name = config.name || definition.name || meta.name;
          if (!name || /^Unnamed\s+(Plugin|Tool|Agent)$/i.test(name)) {
            name = toTitleCaseFromSlug(folderName);
          }
          const description = definition.description || config.description || "TS Agent";

          registry.register({
            name,
            description,
            type: "agent",
            plugin: definition.factory({ ...options, model: defaultModel }),
            capabilities: definition.capabilities,
            subscribe: definition.subscribe || config.subscribe,
            folder: agentDir,
          });
          console.log(`[plugins] Loaded TS agent: ${name} — ${description}`);
        }
      } else {
        // Declarative Agent — AGENT.md only, auto-wrapped with llmPlugin.
        const config = await readAgentConfig(agentDir);
        const meta = await getPluginMetadata(agentDir);
        let resolvedName = config.name || meta.name;
        if (!resolvedName || /^Unnamed\s+(Plugin|Tool|Agent)$/i.test(resolvedName)) {
          resolvedName = toTitleCaseFromSlug(folderName);
        }
        const resolvedDescription = config.description || meta.description || "No description";

        const agentModel = config.model
          ? createModel({ ...options, model: config.model })
          : defaultModel;

        // Load agent-local tool plugins
        const localPlugins = await loadToolPluginsFromDir(path.join(agentDir, "plugins"));

        // Scoped registry: global tools + local tools
        const scopedRegistry = new PluginRegistry();
        for (const p of registry.getTools()) {
          scopedRegistry.register(p);
        }
        for (const p of localPlugins) {
          scopedRegistry.register(p);
        }

        // Initialize AGENT.md if missing
        const agentMdPath = path.join(agentDir, "AGENT.md");
        if (!(await fileExists(agentMdPath))) {
          const content = DEFAULT_AGENT_MD.replace("name: Agent", `name: ${resolvedName}`);
          await fs.writeFile(agentMdPath, content, "utf-8");
          console.log(`[plugins] Initialized ${resolvedName}/AGENT.md`);
        }

        const { plugin, toolDefinitions } = composeAgentFromConfig(config, scopedRegistry, agentModel as LanguageModel);

        registry.register({
          name: resolvedName,
          description: resolvedDescription,
          type: "agent",
          plugin,
          capabilities: Object.fromEntries(
            Object.entries(toolDefinitions).map(([name, def]) => [name, (def as any).description])
          ),
          subscribe: config.subscribe,
          folder: agentDir,
        });
        console.log(`[plugins] Loaded agent: ${resolvedName} — ${resolvedDescription}${config.model ? ` (model: ${config.model})` : ""}`);
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.warn(`[plugins] Error loading "${folderName}":`, err);
      }
    }
  }
}

// ── Lightweight listing (for API) ────────────────────────────────────

export async function listPlugins(
  dir: string,
): Promise<{ name: string; description: string; folder: string; type: "tool" | "agent"; hasAgentMd: boolean; image?: string }[]> {
  const plugins: { name: string; description: string; folder: string; type: "tool" | "agent"; hasAgentMd: boolean; image?: string }[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue;

      const pluginDir = path.join(dir, entry.name);
      const hasAgentMd = await fileExists(path.join(pluginDir, "AGENT.md"));
      const hasCode = await fileExists(path.join(pluginDir, "package.json"))
        || !!(await findIndexFile(pluginDir));

      if (hasAgentMd) {
        const config = await readAgentConfig(pluginDir);
        const { name: fallbackName, description: fallbackDescription } = await getPluginMetadata(pluginDir);
        plugins.push({
          name: config.name || fallbackName || "Unnamed Agent",
          description: config.description || fallbackDescription || "No description",
          folder: pluginDir,
          type: "agent",
          hasAgentMd: true,
          image: config.image,
        });
      } else if (hasCode) {
        await ensurePluginReady(pluginDir);
        const indexPath = await findIndexFile(pluginDir);
        const { name: fallbackName, description: fallbackDescription } = await getPluginMetadata(pluginDir);

        if (!indexPath) {
          plugins.push({
            name: fallbackName,
            description: fallbackDescription,
            folder: pluginDir,
            type: "tool",
            hasAgentMd: false,
          });
          continue;
        }

        try {
          const module = await import(pathToFileURL(indexPath).href + `?update=${Date.now()}`);
          const codeAgentDef: TSAgentDefinition | undefined = module.agent;
          const toolEntry = module.plugin || module.default || module.entry;

          if (codeAgentDef && typeof codeAgentDef.factory === "function") {
            plugins.push({
              name: codeAgentDef.name || fallbackName || "Unnamed Agent",
              description: codeAgentDef.description || fallbackDescription || "Code Agent",
              folder: pluginDir,
              type: "agent",
              hasAgentMd: false,
              image: codeAgentDef.image,
            });
          } else if (toolEntry && typeof toolEntry.factory === "function") {
            plugins.push({
              name: toolEntry.name || fallbackName,
              description: toolEntry.description || fallbackDescription,
              folder: pluginDir,
              type: "tool",
              hasAgentMd: false,
            });
          }
        } catch {
          plugins.push({
            name: fallbackName,
            description: fallbackDescription,
            folder: pluginDir,
            type: "tool",
            hasAgentMd: false,
          });
        }
      }
    }
  } catch { /* directory doesn't exist */ }

  return plugins;
}
