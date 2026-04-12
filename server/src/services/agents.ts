import { osAgent } from "../agents/os-agent.js";
import { agentCreatorAgent } from "../agents/agent-creator.js";
import { shellToolDefinitions } from "../plugins/shell.js";
import { fileSystemToolDefinitions } from "../plugins/file-system.js";
import { RuntimeRegistry } from "../registry/runtime-registry.js";
import {
  discoverAgents,
  registerOpenBotRootDefaultAgent,
  listAgents as listAgentsInternal,
  readAgentConfig,
  type AgentConfig,
} from "../registry/agent-loader.js";
import path from "node:path";
import * as fs from "node:fs/promises";
import matter from "gray-matter";
import { loadConfig, resolvePath, DEFAULT_BASE_DIR } from "../app/config.js";

/** Legacy aliases for system agent */
export async function listAgents(): Promise<any[]> {
  const cfg = loadConfig();
  const baseDir = resolvePath(cfg.baseDir || DEFAULT_BASE_DIR);
  return await listAgentsInternal(path.join(baseDir, "agents"));
}

export async function loadAgentConfig(agentId: string): Promise<AgentConfig> {
  const cfg = loadConfig();
  const baseDir = resolvePath(cfg.baseDir || DEFAULT_BASE_DIR);
  const agentDir = path.join(baseDir, "agents", agentId);
  return await readAgentConfig(agentDir);
}

export async function saveAgentConfig(agentId: string, config: Partial<AgentConfig>): Promise<void> {
  const cfg = loadConfig();
  const baseDir = resolvePath(cfg.baseDir || DEFAULT_BASE_DIR);
  const agentDir = path.join(baseDir, "agents", agentId);
  const mdPath = path.join(agentDir, "AGENT.md");

  let content = "";
  try {
    const raw = await fs.readFile(mdPath, "utf-8");
    const parsed = matter(raw);
    content = parsed.content;
    const nextData = { ...parsed.data, ...config };
    const nextMd = matter.stringify(content, nextData);
    await fs.writeFile(mdPath, nextMd, "utf-8");
  } catch {
    // New agent?
    const nextMd = matter.stringify("", config);
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(mdPath, nextMd, "utf-8");
  }
}

export async function loadAgentMd(agentId: string): Promise<string> {
  const cfg = loadConfig();
  const baseDir = resolvePath(cfg.baseDir || DEFAULT_BASE_DIR);
  const agentDir = path.join(baseDir, "agents", agentId);
  const mdPath = path.join(agentDir, "AGENT.md");
  try {
    return await fs.readFile(mdPath, "utf-8");
  } catch {
    return "";
  }
}

export async function saveAgentMd(agentId: string, md: string): Promise<void> {
  const cfg = loadConfig();
  const baseDir = resolvePath(cfg.baseDir || DEFAULT_BASE_DIR);
  const agentDir = path.join(baseDir, "agents", agentId);
  const mdPath = path.join(agentDir, "AGENT.md");
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(mdPath, md, "utf-8");
}

/**
 * Register built-in and custom agents.
 */
export async function registerAgents(
  registry: RuntimeRegistry,
  resolvedBaseDir: string,
  model: any,
  resolvedModelId: string,
  options?: { openaiApiKey?: string; anthropicApiKey?: string },
): Promise<void> {
  registry.registerAgent({
    id: "os",
    name: "os",
    description: "Handles shell commands and file system operations",
    capabilities: {
      ...Object.fromEntries(
        Object.entries(shellToolDefinitions).map(([k, v]) => [k, v.description]),
      ),
      ...Object.fromEntries(
        Object.entries(fileSystemToolDefinitions).map(([k, v]) => [k, v.description]),
      ),
    },
    plugin: osAgent({ model, resolvedModelId, resolvedBaseDir, registry }),
    isBuiltIn: true,
  });

  registry.registerAgent({
    id: "agent-creator",
    name: "agent-creator",
    description: "Helps the user create and update custom OpenBot agents via natural language.",
    capabilities: {
      ...Object.fromEntries(
        Object.entries(fileSystemToolDefinitions).map(([k, v]) => [k, v.description]),
      ),
    },
    plugin: agentCreatorAgent({ model, resolvedModelId, resolvedBaseDir, registry }),
    isBuiltIn: true,
  });

  await discoverAgents(path.join(resolvedBaseDir, "agents"), registry, model, resolvedModelId, resolvedBaseDir, options);
  await registerOpenBotRootDefaultAgent(registry, resolvedBaseDir, model, resolvedModelId, options);
}
