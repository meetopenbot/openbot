import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MelonyPlugin } from 'melony';
import type { AgentPackage, AgentPackageContext } from '../bus/agent-package.js';
import type { OpenBotEvent, OpenBotState } from '../app/types.js';
import { openBotAgentPackage } from '../agents/openbot/index.js';
import { DEFAULT_AGENT_PACKAGES_DIR, DEFAULT_BASE_DIR, loadConfig, resolvePath } from '../app/config.js';

let agentPackagesDir: string | null = null;
const loadedPackages = new Set<string>();
const cache = new Map<string, AgentPackage>();

const BUILT_IN: Record<string, AgentPackage> = {
  [openBotAgentPackage.id]: openBotAgentPackage,
};

/**
 * Normalize a dynamically imported agent package module. Supports:
 * - `agentPackage`, `default` (current AgentPackage layout)
 * - `plugin`: legacy/community bundles that used `{ kind: "runtime", factory: (opts) => ... }`
 *   where opts should come from agent config (merged at runtime via AgentPackageContext).
 */
export function parseAgentPackageModule(module: Record<string, unknown>): AgentPackage | null {
  const raw =
    (module.agentPackage as Record<string, unknown> | undefined) ??
    (module.default as Record<string, unknown> | undefined) ??
    (module.plugin as Record<string, unknown> | undefined);

  if (!raw || typeof raw !== 'object') return null;

  const id = raw.id;
  const name = raw.name;
  const factory = raw.factory;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof factory !== 'function') {
    return null;
  }

  const description = typeof raw.description === 'string' ? raw.description : '';

  if (raw.kind === 'runtime') {
    const legacyFactory = factory as (
      opts: Record<string, unknown>,
    ) => MelonyPlugin<OpenBotState, OpenBotEvent>;

    return {
      id,
      name,
      description,
      image: typeof raw.image === 'string' ? raw.image : undefined,
      defaultInstructions:
        typeof raw.defaultInstructions === 'string' ? raw.defaultInstructions : undefined,
      configSchema: raw.configSchema as AgentPackage['configSchema'],
      factory: (ctx: AgentPackageContext) => {
        const opts =
          ctx.config && typeof ctx.config === 'object' && !Array.isArray(ctx.config)
            ? { ...ctx.config }
            : {};
        return legacyFactory(opts);
      },
    };
  }

  return raw as unknown as AgentPackage;
}

async function resolveCommunityDistPath(agentPackagesDir: string, id: string): Promise<string | null> {
  const direct = path.join(agentPackagesDir, id, 'dist', 'index.js');
  if (fs.existsSync(direct)) return direct;

  try {
    const entries = await fsPromises.readdir(agentPackagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const distPath = path.join(agentPackagesDir, entry.name, 'dist', 'index.js');
      if (!fs.existsSync(distPath)) continue;
      try {
        const mod = await import(pathToFileURL(distPath).href);
        const pkg = parseAgentPackageModule(mod as Record<string, unknown>);
        if (pkg?.id === id) return distPath;
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }

  return null;
}

/** Initialize the on-disk agent packages directory (defaults to ~/.openbot/agent-packages). */
export function initAgentPackages(dir?: string) {
  if (dir) {
    agentPackagesDir = dir;
  } else {
    const config = loadConfig();
    const baseDir = config.baseDir || DEFAULT_BASE_DIR;
    agentPackagesDir = path.join(resolvePath(baseDir), DEFAULT_AGENT_PACKAGES_DIR);
  }
}

/**
 * Resolve an AgentPackage by id. Looks up built-in packages first, then any
 * community packages installed under the agent-packages directory.
 */
export async function resolveAgentPackage(id: string): Promise<AgentPackage | null> {
  if (cache.has(id)) return cache.get(id)!;
  if (BUILT_IN[id]) {
    cache.set(id, BUILT_IN[id]);
    return BUILT_IN[id];
  }

  if (!agentPackagesDir) {
    initAgentPackages();
  }

  if (!agentPackagesDir) return null;

  const distPath = await resolveCommunityDistPath(agentPackagesDir, id);

  if (!distPath) {
    console.warn(
      `[agents] AgentPackage "${id}" not found in registry or under ${agentPackagesDir}.`,
    );
    return null;
  }

  try {
    const module = await import(pathToFileURL(distPath).href);
    const pkg = parseAgentPackageModule(module as Record<string, unknown>);
    if (!pkg) {
      console.warn(`[agents] AgentPackage "${id}" at ${distPath} has no recognizable export.`);
      return null;
    }
    cache.set(id, pkg);
    if (!loadedPackages.has(id)) {
      console.log(`[agents] Loaded community agent package "${id}" from ${distPath}`);
      loadedPackages.add(id);
    }
    return pkg;
  } catch (e) {
    console.warn(`[agents] Failed to load agent package "${id}" from ${distPath}:`, e);
    return null;
  }
}

/** List built-in agent package descriptors (for marketplace/registry views). */
export function listBuiltInAgentPackages(): AgentPackage[] {
  return Object.values(BUILT_IN);
}

export function getAgentPackagesDir(): string | null {
  return agentPackagesDir;
}
