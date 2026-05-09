import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MelonyPlugin } from 'melony';
import type { AgentPackage, AgentPackageContext } from '../bus/agent-package.js';
import type { OpenBotEvent, OpenBotState } from '../app/types.js';
import { openBotAgentPackage } from '../agents/openbot/index.js';
import { claudeCodeAgentPackage } from '../agents/claude-code/index.js';
import { geminiCliAgentPackage } from '../agents/gemini-cli/index.js';
import { DEFAULT_AGENT_PACKAGES_DIR, DEFAULT_BASE_DIR, loadConfig, resolvePath } from '../app/config.js';

let agentPackagesDir: string | null = null;
const loadedPackages = new Set<string>();
const cache = new Map<string, AgentPackage>();

const BUILT_IN: Record<string, AgentPackage> = {
  [openBotAgentPackage.id]: openBotAgentPackage,
  [claudeCodeAgentPackage.id]: claudeCodeAgentPackage,
  [geminiCliAgentPackage.id]: geminiCliAgentPackage,
};

/**
 * Parsed shape of a community agent package module. The `id` is intentionally
 * omitted: the canonical id is the npm package name (== folder under
 * `agent-packages/`), assigned by the caller. Modules only contribute behaviour
 * (factory + optional metadata).
 */
export type ParsedAgentPackageModule = Omit<AgentPackage, 'id'>;

/**
 * Normalize a dynamically imported agent package module. Supports:
 * - `agentPackage`, `default` (current AgentPackage layout)
 * - `plugin`: community bundles using `{ kind: "runtime", factory: (opts) => ... }`
 *   where opts come from the agent's `config` via the AgentPackageContext.
 */
export function parseAgentPackageModule(
  module: Record<string, unknown>,
): ParsedAgentPackageModule | null {
  const raw =
    (module.agentPackage as Record<string, unknown> | undefined) ??
    (module.default as Record<string, unknown> | undefined) ??
    (module.plugin as Record<string, unknown> | undefined);

  if (!raw || typeof raw !== 'object') return null;

  const factory = raw.factory;
  if (typeof factory !== 'function') return null;

  const name = typeof raw.name === 'string' ? raw.name : '';
  const description = typeof raw.description === 'string' ? raw.description : '';
  const image = typeof raw.image === 'string' ? raw.image : undefined;
  const defaultInstructions =
    typeof raw.defaultInstructions === 'string' ? raw.defaultInstructions : undefined;
  const configSchema = raw.configSchema as AgentPackage['configSchema'];

  if (raw.kind === 'runtime') {
    const legacyFactory = factory as (
      opts: Record<string, unknown>,
    ) => MelonyPlugin<OpenBotState, OpenBotEvent>;

    return {
      name,
      description,
      image,
      defaultInstructions,
      configSchema,
      factory: (ctx: AgentPackageContext) => {
        const opts =
          ctx.config && typeof ctx.config === 'object' && !Array.isArray(ctx.config)
            ? { ...ctx.config }
            : {};
        return legacyFactory(opts);
      },
    };
  }

  return {
    name,
    description,
    image,
    defaultInstructions,
    configSchema,
    factory: factory as AgentPackage['factory'],
  };
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
 * Resolve an AgentPackage by id. The id is either:
 *   - a built-in id (e.g. "openbot"), or
 *   - an npm package name (e.g. "openbot-plugin-codex" or "@scope/foo"),
 *     in which case the folder layout is `agent-packages/<id>/dist/index.js`.
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

  const distPath = path.join(agentPackagesDir, id, 'dist', 'index.js');

  if (!fs.existsSync(distPath)) {
    console.warn(
      `[agents] AgentPackage "${id}" not found at ${distPath}.`,
    );
    return null;
  }

  try {
    const module = await import(pathToFileURL(distPath).href);
    const parsed = parseAgentPackageModule(module as Record<string, unknown>);
    if (!parsed) {
      console.warn(`[agents] AgentPackage "${id}" at ${distPath} has no recognizable export.`);
      return null;
    }
    const pkg: AgentPackage = { id, ...parsed, name: parsed.name || id };
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

/** Drop a single id from the in-memory cache (e.g. after fresh install). */
export function invalidateAgentPackage(id: string): void {
  cache.delete(id);
  loadedPackages.delete(id);
}

/** List built-in agent package descriptors (for marketplace/registry views). */
export function listBuiltInAgentPackages(): AgentPackage[] {
  return Object.values(BUILT_IN);
}

export function getAgentPackagesDir(): string | null {
  return agentPackagesDir;
}
