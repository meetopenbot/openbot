import { ORCHESTRATOR_AGENT_ID, STATE_AGENT_ID } from '../../app/agent-ids.js';
import {
  DEFAULT_PLUGINS_DIR,
  DEFAULT_AGENTS_DIR,
  DEFAULT_BASE_DIR,
  DEFAULT_CHANNELS_DIR,
  loadConfig,
  resolvePath,
  StoredVariable,
  VARIABLES_FILE,
} from '../../app/config.js';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import {
  Agent,
  AgentDetails,
  Channel,
  ChannelDetails,
  PluginDescriptor,
  Thread,
  ThreadDetails,
} from '../../services/plugins/domain.js';
import type { PluginRef } from '../../services/plugins/types.js';
import { openbotPlugin } from '../openbot/index.js';
import { OPENBOT_SYSTEM_PROMPT } from '../openbot/system-prompt.js';
import { listBuiltInPlugins, parsePluginModule } from '../../services/plugins/registry.js';
import { OpenBotEvent, OpenBotState } from '../../app/types.js';
import { processService } from '../../services/process.js';
import { memoryService } from '../memory/service.js';

const resolveBaseDir = () => {
  const config = loadConfig();
  return resolvePath(config.baseDir || DEFAULT_BASE_DIR);
};

const ENTITY_SVG_CANDIDATE_NAMES = ['avatar.svg', 'icon.svg', 'image.svg', 'logo.svg'] as const;

const toSvgDataUrl = (svg: string) =>
  `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;

let bundledSystemAgentImage: string | undefined;
let bundledSystemAgentImageLoaded = false;

/** OpenBot mark from `src/assets/icon.svg` (also copied to `dist/assets` at build). */
function getBundledSystemAgentImage(): string | undefined {
  if (bundledSystemAgentImageLoaded) return bundledSystemAgentImage;
  bundledSystemAgentImageLoaded = true;
  try {
    const iconPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../assets/icon.svg',
    );
    const trimmed = readFileSync(iconPath, 'utf-8').trim();
    if (!trimmed.startsWith('<svg')) return undefined;
    bundledSystemAgentImage = toSvgDataUrl(trimmed);
  } catch {
    bundledSystemAgentImage = undefined;
  }
  return bundledSystemAgentImage;
}

const tryReadSvgDataUrl = async (filePath: string): Promise<string | null> => {
  try {
    const svg = await fs.readFile(filePath, 'utf-8');
    const trimmed = svg.trim();
    if (!trimmed.startsWith('<svg')) return null;
    return toSvgDataUrl(trimmed);
  } catch {
    return null;
  }
};

const resolveEntityImageDataUrl = async (entityDir: string): Promise<string | undefined> => {
  const preferredDirs = [path.join(entityDir, 'assets'), entityDir];

  for (const dir of preferredDirs) {
    for (const fileName of ENTITY_SVG_CANDIDATE_NAMES) {
      const dataUrl = await tryReadSvgDataUrl(path.join(dir, fileName));
      if (dataUrl) return dataUrl;
    }
  }

  for (const dir of preferredDirs) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const firstSvg = entries.find(
        (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.svg'),
      );
      if (!firstSvg) continue;
      const dataUrl = await tryReadSvgDataUrl(path.join(dir, firstSvg.name));
      if (dataUrl) return dataUrl;
    } catch {
      // ignore
    }
  }

  return undefined;
};

const getConversationDir = (channelId: string, threadId?: string) => {
  const base = resolvePath(resolveBaseDir() + '/' + DEFAULT_CHANNELS_DIR + '/' + channelId);
  return threadId ? `${base}/threads/${threadId}` : base;
};

/** Built-in orchestrator agent id. Not creatable as a normal disk agent. */
const SYSTEM_AGENT_ID = ORCHESTRATOR_AGENT_ID;

const SYSTEM_DEFAULT_PLUGINS: PluginRef[] = [
  { id: 'naming' },
  { id: 'openbot', config: { model: 'openai/gpt-5.4-mini' } },
  { id: 'shell' },
  { id: 'approval' },
  { id: 'memory' },
  { id: 'delegation' },
  { id: 'storage' },
];

/** No `openbot` / `shell` — storage-side effects and infra plugins only. */
const STATE_DEFAULT_PLUGINS: PluginRef[] = [
  { id: 'storage' },
  { id: 'plugin-manager' },
];

const STATE_AGENT_INSTRUCTIONS =
  'Built-in infra agent for deterministic state reads. No conversational model is attached; handle storage, approvals, memory, and plugin marketplace events.';

function getSystemAgentDetails(overrides?: Partial<AgentDetails>): AgentDetails {
  const defaults: AgentDetails = {
    id: SYSTEM_AGENT_ID,
    name: 'OpenBot',
    image: getBundledSystemAgentImage(),
    description:
      'First-party orchestration agent for OpenBot.',
    instructions: OPENBOT_SYSTEM_PROMPT,
    plugins: SYSTEM_DEFAULT_PLUGINS.map((ref) => ref.id),
    pluginRefs: SYSTEM_DEFAULT_PLUGINS,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  if (!overrides) return defaults;

  const refs = overrides.pluginRefs && overrides.pluginRefs.length > 0
    ? overrides.pluginRefs
    : defaults.pluginRefs;

  const diskInstructions = overrides.instructions?.trim();
  const instructions =
    diskInstructions && diskInstructions.length > 0 ? diskInstructions : defaults.instructions;

  return {
    ...defaults,
    ...overrides,
    id: SYSTEM_AGENT_ID,
    instructions,
    image: overrides.image || defaults.image,
    plugins: refs.map((ref) => ref.id),
    pluginRefs: refs,
    updatedAt: new Date(),
  };
}

function getStateAgentDetails(overrides?: Partial<AgentDetails>): AgentDetails {
  const defaults: AgentDetails = {
    id: STATE_AGENT_ID,
    name: 'State',
    image: getBundledSystemAgentImage(),
    description: 'Infrastructure agent for OpenBot — storage and hooks without an LLM.',
    instructions: STATE_AGENT_INSTRUCTIONS,
    plugins: STATE_DEFAULT_PLUGINS.map((ref) => ref.id),
    pluginRefs: STATE_DEFAULT_PLUGINS,
    hidden: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  if (!overrides) return defaults;

  const refs = overrides.pluginRefs && overrides.pluginRefs.length > 0
    ? overrides.pluginRefs
    : defaults.pluginRefs;

  const diskInstructions = overrides.instructions?.trim();
  const instructions =
    diskInstructions && diskInstructions.length > 0 ? diskInstructions : defaults.instructions;

  return {
    ...defaults,
    ...overrides,
    id: STATE_AGENT_ID,
    instructions,
    image: overrides.image || defaults.image,
    hidden: overrides.hidden !== undefined ? overrides.hidden : defaults.hidden,
    plugins: refs.map((ref) => ref.id),
    pluginRefs: refs,
    updatedAt: new Date(),
  };
}

const agentSummaryFromDetails = (details: AgentDetails): Agent => ({
  id: details.id,
  name: details.name || details.id,
  description: details.description || '',
  image: details.image,
  plugins: details.plugins,
  hidden: details.hidden,
  createdAt: details.createdAt,
  updatedAt: details.updatedAt,
});

// Suppress unused warning until system agent customization re-uses openbotPlugin metadata.
void openbotPlugin;

/** Built-in agents may persist optional `agents/<id>/AGENT.md` overlays; read path merges them with defaults. */
const isBuiltinOverlayAgentId = (agentId: string): boolean =>
  agentId === SYSTEM_AGENT_ID || agentId === STATE_AGENT_ID;

const assertAgentIdFormat = (agentId: string): void => {
  if (!agentId || typeof agentId !== 'string') {
    throw new Error('agentId is required');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
    throw new Error('agentId must contain only letters, digits, underscores, and hyphens');
  }
};

const getAgentsRootDir = () => path.join(resolveBaseDir(), DEFAULT_AGENTS_DIR);

const getLastReadFilePath = () =>
  path.join(resolvePath(resolveBaseDir() + '/' + DEFAULT_CHANNELS_DIR), '_meta', 'last-read.json');

const THREAD_TITLE_MAX_LENGTH = 80;

const buildThreadTitleFromEvent = (event: OpenBotEvent): string | undefined => {
  let rawContent = '';

  if (
    event.type === 'agent:invoke' &&
    event.data?.role === 'user' &&
    typeof event.data.content === 'string'
  ) {
    rawContent = event.data.content;
  }

  const normalized = rawContent.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;

  if (normalized.length <= THREAD_TITLE_MAX_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, THREAD_TITLE_MAX_LENGTH).trimEnd()}...`;
};

const readJsonFile = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T;
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === 'ENOENT') return fallback;
    throw e;
  }
};

const toVariablesRecord = (raw: unknown): Record<string, string> => {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  if ('variables' in raw && Array.isArray((raw as { variables?: unknown }).variables)) {
    const entries = (raw as { variables: StoredVariable[] }).variables
      .filter((variable) => typeof variable?.key === 'string')
      .map((variable) => [variable.key, String(variable.value ?? '')] as const);
    return Object.fromEntries(entries);
  }

  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).map(([key, value]) => [
      key,
      String(value ?? ''),
    ]),
  );
};

const listBuiltInPluginDescriptors = async (): Promise<PluginDescriptor[]> => {
  return listBuiltInPlugins().map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    builtIn: true,
    image: plugin.image,
    configSchema: plugin.configSchema,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
};

/**
 * Walk `plugins/` and yield candidate plugin ids (npm names). Includes scoped
 * packages by recursing one level into directories starting with `@`.
 */
const listInstalledPluginIds = async (pluginsDir: string): Promise<string[]> => {
  const out: string[] = [];
  let topEntries;
  try {
    topEntries = await fs.readdir(pluginsDir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of topEntries) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    if (entry.name.startsWith('@')) {
      try {
        const inner = await fs.readdir(path.join(pluginsDir, entry.name), { withFileTypes: true });
        for (const sub of inner) {
          if (sub.name.startsWith('.')) continue;
          if (sub.isDirectory() || sub.isSymbolicLink()) {
            out.push(`${entry.name}/${sub.name}`);
          }
        }
      } catch {
        // ignore
      }
      continue;
    }

    out.push(entry.name);
  }

  return out;
};

const listPluginsFromDisk = async (): Promise<PluginDescriptor[]> => {
  const pluginsDir = resolvePath(resolveBaseDir() + '/' + DEFAULT_PLUGINS_DIR);
  try {
    await fs.access(pluginsDir);
  } catch {
    await fs.mkdir(pluginsDir, { recursive: true });
  }

  const ids = await listInstalledPluginIds(pluginsDir);

  const descriptors = await Promise.all(
    ids.map(async (id): Promise<PluginDescriptor | null> => {
      try {
        const pluginDir = path.join(pluginsDir, id);
        const distPath = path.join(pluginDir, 'dist', 'index.js');
        const module = await import(pathToFileURL(distPath).href);
        const parsed = parsePluginModule(module as Record<string, unknown>);
        if (!parsed) return null;
        const image = await resolveEntityImageDataUrl(pluginDir);
        return {
          id,
          name: parsed.name || id,
          description: parsed.description || '',
          builtIn: false,
          image: parsed.image || image,
          configSchema: parsed.configSchema,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      } catch (error) {
        console.warn(`[storage] Failed to load plugin ${id}:`, error);
        return null;
      }
    }),
  );

  return descriptors.filter((d): d is PluginDescriptor => d !== null);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Display-oriented fields persisted in a channel's `state.json`. */
const readChannelStateFileFields = (
  parsed: unknown,
): { name?: string; cwd?: string; participants: string[] } => {
  if (!isRecord(parsed)) {
    return { participants: [] };
  }
  const name =
    typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : undefined;
  const cwd = typeof parsed.cwd === 'string' ? parsed.cwd : undefined;
  const participants: string[] = [];
  if (Array.isArray(parsed.participants)) {
    for (const x of parsed.participants) {
      if (typeof x === 'string' && x.trim()) participants.push(x.trim());
    }
  }
  return { name, cwd, participants };
};

/**
 * Parse the `plugins:` array from AGENT.md frontmatter. Each entry must have an
 * `id`; `config` is optional. Strings are accepted as a shorthand for `{ id }`.
 */
const parseHiddenFlag = (raw: unknown): boolean | undefined => {
  if (raw === true) return true;
  if (raw === false) return false;
  return undefined;
};

const parsePluginRefs = (raw: unknown): PluginRef[] => {
  if (!Array.isArray(raw)) return [];
  const refs: PluginRef[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string' && entry.trim()) {
      refs.push({ id: entry.trim() });
      continue;
    }
    if (isRecord(entry) && typeof entry.id === 'string' && entry.id.trim()) {
      const config = isRecord(entry.config) ? (entry.config as Record<string, unknown>) : undefined;
      refs.push({ id: entry.id.trim(), ...(config ? { config } : {}) });
    }
  }
  return refs;
};

const serializePluginRefs = (refs: PluginRef[]): unknown[] =>
  refs.map((ref) => (ref.config ? { id: ref.id, config: ref.config } : { id: ref.id }));

export const storageService = {
  getLastReadByChannel: async (): Promise<Record<string, string>> => {
    return readJsonFile(getLastReadFilePath(), {});
  },

  setLastReadForChannel: async ({
    channelId,
    lastReadEventId,
  }: {
    channelId: string;
    lastReadEventId: string;
  }): Promise<void> => {
    const p = getLastReadFilePath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    const map = await readJsonFile<Record<string, string>>(p, {});
    map[channelId] = lastReadEventId;
    await fs.writeFile(p, JSON.stringify(map, null, 2), 'utf-8');
  },

  getChannels: async (): Promise<Channel[]> => {
    const channelsDir = resolvePath(resolveBaseDir() + '/' + DEFAULT_CHANNELS_DIR);
    try {
      await fs.access(channelsDir);
    } catch {
      await fs.mkdir(channelsDir, { recursive: true });
    }

    const channelNames = (await fs.readdir(channelsDir)).filter(
      (name) => !name.startsWith('.') && name !== '_meta',
    );
    const lastReadByChannel = await storageService.getLastReadByChannel();

    const channels = await Promise.all(
      channelNames.map(async (name) => {
        const channelDir = getConversationDir(name);
        const statePath = path.join(channelDir, 'state.json');
        let cwd: string | undefined;
        let displayName = name;
        let participants: string[] = [];

        try {
          const stateContent = await fs.readFile(statePath, 'utf-8');
          const parsed = JSON.parse(stateContent);
          const fields = readChannelStateFileFields(parsed);
          cwd = fields.cwd;
          displayName = fields.name ?? name;
          participants = fields.participants;
        } catch {
          // ignore
        }

        const channel: Channel = {
          id: name,
          name: displayName,
          description: '',
          cwd,
          participants,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const rid = lastReadByChannel[name];
        try {
          const events = await storageService.getEvents({ channelId: name });
          const latestId = events[events.length - 1]?.id;
          channel.hasUnseenMessages = !!(latestId && latestId !== rid);
        } catch {
          channel.hasUnseenMessages = false;
        }

        try {
          const allThreads = await storageService.getThreads({ channelId: name });
          channel.recentThreads = allThreads
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
            .slice(0, 5);
        } catch {
          channel.recentThreads = [];
        }

        return channel;
      }),
    );

    return channels;
  },
  createChannel: async ({
    channelId,
    spec,
    initialState,
    cwd,
  }: {
    channelId: string;
    spec?: string;
    initialState?: Record<string, unknown>;
    cwd?: string;
  }): Promise<void> => {
    const normalizedChannelId = channelId.trim();
    if (!normalizedChannelId) {
      throw new Error('channelId is required');
    }

    const channelDir = getConversationDir(normalizedChannelId);
    const specPath = `${channelDir}/SPEC.md`;
    const statePath = `${channelDir}/state.json`;

    try {
      await fs.access(channelDir);
      throw new Error(`Channel "${normalizedChannelId}" already exists`);
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }

    const finalState = {
      ...(initialState || {}),
    };

    if (cwd) {
      (finalState as Record<string, unknown>).cwd = cwd;
    }

    await fs.mkdir(channelDir, { recursive: true });
    await fs.writeFile(
      specPath,
      spec?.trim() ||
      `# ${normalizedChannelId}\n\nDefine the goals and rules for this channel here.\n`,
    );
    await fs.writeFile(statePath, JSON.stringify(finalState, null, 2));
  },
  createThread: async ({
    channelId,
    threadId,
    threadTitle,
    initialState,
  }: {
    channelId: string;
    threadId: string;
    threadTitle?: string;
    initialState?: Record<string, unknown>;
  }): Promise<void> => {
    const normalizedChannelId = channelId.trim();
    const normalizedThreadId = threadId.trim();

    if (!normalizedChannelId) throw new Error('channelId is required');
    if (!normalizedThreadId) throw new Error('threadId is required');

    const threadDir = getConversationDir(normalizedChannelId, normalizedThreadId);
    const statePath = `${threadDir}/state.json`;

    try {
      await fs.access(threadDir);
      throw new Error(
        `Thread "${normalizedThreadId}" already exists in channel "${normalizedChannelId}"`,
      );
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }

    const baseState: Record<string, unknown> = { ...(initialState || {}) };
    if (threadTitle?.trim()) {
      baseState.name = threadTitle.trim();
    }

    await fs.mkdir(threadDir, { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(baseState, null, 2));
  },
  getThreads: async ({ channelId }: { channelId: string }): Promise<Thread[]> => {
    const threadsDir = resolvePath(
      resolveBaseDir() + '/' + DEFAULT_CHANNELS_DIR + '/' + channelId + '/threads',
    );
    try {
      await fs.access(threadsDir);
    } catch {
      return [];
    }

    const threadNames = (await fs.readdir(threadsDir)).filter((name) => !name.startsWith('.'));

    const threads = await Promise.all(
      threadNames.map(async (name) => {
        const threadPath = path.join(threadsDir, name);
        const stats = await fs.stat(threadPath);
        const threadStatePath = path.join(threadPath, 'state.json');
        let threadDisplayName = name;

        try {
          const threadStateRaw = await fs.readFile(threadStatePath, 'utf-8');
          const threadState = JSON.parse(threadStateRaw) as Record<string, unknown>;
          const threadName =
            typeof threadState.name === 'string' ? threadState.name.trim() : '';
          if (threadName) {
            threadDisplayName = threadName;
          }
        } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
            console.error(
              `Failed to read thread state for channel ${channelId} thread ${name}`,
              error,
            );
          }
        }

        return {
          id: name,
          name: threadDisplayName,
          channelId,
          createdAt: stats.birthtime,
          updatedAt: stats.mtime,
        };
      }),
    );

    return threads;
  },
  getThreadDetails: async ({
    channelId,
    threadId,
  }: {
    channelId: string;
    threadId: string;
  }): Promise<ThreadDetails> => {
    const threadDir = getConversationDir(channelId, threadId);
    const statePath = `${threadDir}/state.json`;

    let state: unknown = {};
    try {
      const stateContent = await fs.readFile(statePath, 'utf-8');
      state = JSON.parse(stateContent);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.error(
          `Failed to read thread state for channel ${channelId} thread ${threadId}`,
          error,
        );
      }
    }

    const threadName =
      isRecord(state) && typeof state.name === 'string'
        ? state.name.trim()
        : '';

    return {
      id: threadId,
      name: threadName || threadId,
      channelId,
      state,
    };
  },
  getChannelDetails: async ({ channelId }: { channelId: string }): Promise<ChannelDetails> => {
    const channelDir = getConversationDir(channelId);
    const specPath = `${channelDir}/SPEC.md`;
    const statePath = `${channelDir}/state.json`;

    let spec = '';
    try {
      spec = await fs.readFile(specPath, 'utf-8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.error(`Failed to read spec file for channel ${channelId}`, error);
      }
    }

    let state: unknown = {};
    try {
      const stateContent = await fs.readFile(statePath, 'utf-8');
      state = JSON.parse(stateContent);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.error(`Failed to read state file for channel ${channelId}`, error);
      }
    }

    const diskFields = readChannelStateFileFields(state);
    const cwd = diskFields.cwd;
    const displayName = diskFields.name ?? channelId;

    const details: ChannelDetails = {
      id: channelId,
      name: displayName,
      spec,
      state,
      cwd,
      participants: diskFields.participants,
    };

    details.threads = await storageService.getThreads({ channelId });

    return details;
  },
  patchChannelState: async ({
    channelId,
    state: patch,
  }: {
    channelId: string;
    state: unknown;
  }): Promise<void> => {
    const channelDir = getConversationDir(channelId);
    const statePath = `${channelDir}/state.json`;

    try {
      const currentDetails = await storageService.getChannelDetails({ channelId });
      const currentState = (currentDetails.state as Record<string, unknown>) || {};

      const newState = {
        ...currentState,
        ...(patch as Record<string, unknown>),
      };

      await fs.mkdir(channelDir, { recursive: true });
      await fs.writeFile(statePath, JSON.stringify(newState, null, 2));
    } catch (error) {
      console.error(`Failed to patch channel state for channel ${channelId}`, error);
      throw error;
    }
  },
  patchThreadState: async ({
    channelId,
    threadId,
    state: patch,
  }: {
    channelId: string;
    threadId: string;
    state: unknown;
  }): Promise<void> => {
    const threadDir = getConversationDir(channelId, threadId);
    const statePath = `${threadDir}/state.json`;

    try {
      const currentDetails = await storageService.getThreadDetails({ channelId, threadId });
      const currentState = (currentDetails.state as Record<string, unknown>) || {};

      const newState = {
        ...currentState,
        ...(patch as Record<string, unknown>),
      };

      await fs.mkdir(threadDir, { recursive: true });
      await fs.writeFile(statePath, JSON.stringify(newState, null, 2));
    } catch (error) {
      console.error(
        `Failed to patch thread state for channel ${channelId} thread ${threadId}`,
        error,
      );
      throw error;
    }
  },
  patchChannelSpec: async ({
    channelId,
    spec,
  }: {
    channelId: string;
    spec: string;
  }): Promise<void> => {
    const channelDir = getConversationDir(channelId);
    const specPath = `${channelDir}/SPEC.md`;

    try {
      await fs.mkdir(channelDir, { recursive: true });
      await fs.writeFile(specPath, spec);
    } catch (error) {
      console.error(`Failed to patch channel spec for channel ${channelId}`, error);
      throw error;
    }
  },
  getAgents: async (): Promise<Agent[]> => {
    const agentsDir = resolvePath(resolveBaseDir() + '/' + DEFAULT_AGENTS_DIR);
    try {
      await fs.access(agentsDir);
    } catch {
      await fs.mkdir(agentsDir, { recursive: true });
    }

    const agentIds = (await fs.readdir(agentsDir)).filter((name) => !name.startsWith('.'));

    const agents = await Promise.all(
      agentIds.map(async (id) => {
        try {
          const details = await storageService.getAgentDetails({ agentId: id });
          return agentSummaryFromDetails(details);
        } catch {
          return {
            id,
            name: id,
            description: '',
            plugins: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          } satisfies Agent;
        }
      }),
    );

    const system = await storageService.getAgentDetails({ agentId: SYSTEM_AGENT_ID });
    const builtInSystemAgent = agentSummaryFromDetails(system);

    const builtInStateRow = await storageService.getAgentDetails({ agentId: STATE_AGENT_ID });
    const builtInStateAgent = agentSummaryFromDetails(builtInStateRow);

    const deduped = new Map<string, Agent>();
    deduped.set(builtInSystemAgent.id, builtInSystemAgent);
    deduped.set(builtInStateAgent.id, builtInStateAgent);
    for (const agent of agents) {
      if (!deduped.has(agent.id)) deduped.set(agent.id, agent);
    }

    return Array.from(deduped.values()).filter((agent) => !agent.hidden);
  },
  getPlugins: async (): Promise<PluginDescriptor[]> => {
    const [builtIn, fromDisk] = await Promise.all([
      listBuiltInPluginDescriptors(),
      listPluginsFromDisk(),
    ]);

    const merged = [...builtIn, ...fromDisk];
    const deduped = new Map<string, PluginDescriptor>();
    for (const plugin of merged) {
      if (!deduped.has(plugin.id)) {
        deduped.set(plugin.id, plugin);
      }
    }
    return Array.from(deduped.values());
  },
  getAgentDetails: async ({ agentId }: { agentId: string }): Promise<AgentDetails> => {
    const agentDir = resolvePath(resolveBaseDir() + '/' + DEFAULT_AGENTS_DIR + '/' + agentId);
    const agentMdPath = `${agentDir}/AGENT.md`;

    let diskDetails: Partial<AgentDetails> | undefined;

    try {
      await fs.access(agentMdPath);
      const agentMd = await fs.readFile(agentMdPath, 'utf-8');
      const { data, content: instructions } = matter(agentMd);
      const discoveredImage = await resolveEntityImageDataUrl(agentDir);
      const stats = await fs.stat(agentMdPath);

      const pluginRefs = parsePluginRefs(data.plugins);
      const frontmatterImage =
        typeof data.image === 'string' && data.image.trim() !== ''
          ? data.image.trim()
          : undefined;

      diskDetails = {
        id: agentId,
        name: typeof data.name === 'string' ? data.name : agentId,
        instructions: instructions.trim(),
        plugins: pluginRefs.map((ref) => ref.id),
        pluginRefs,
        description: typeof data.description === 'string' ? data.description : '',
        image: frontmatterImage || discoveredImage || undefined,
        hidden: parseHiddenFlag(data.hidden),
        createdAt: stats.birthtime,
        updatedAt: stats.mtime,
      };
    } catch (error) {
      if (agentId !== SYSTEM_AGENT_ID && agentId !== STATE_AGENT_ID) {
        const err = new Error(`Agent "${agentId}" does not exist.`);
        (err as Error & { code?: string }).code = 'AGENT_NOT_FOUND';
        throw err;
      }
      // swallow: built-in agents have optional `agents/<id>/AGENT.md` overrides
      void error;
    }

    if (agentId === SYSTEM_AGENT_ID) {
      return getSystemAgentDetails(diskDetails);
    }

    if (agentId === STATE_AGENT_ID) {
      return getStateAgentDetails(diskDetails);
    }

    if (!diskDetails) {
      const error = new Error(`Agent "${agentId}" does not exist.`);
      (error as Error & { code?: string }).code = 'AGENT_NOT_FOUND';
      throw error;
    }

    return diskDetails as AgentDetails;
  },
  createAgent: async ({
    agentId,
    name,
    description = '',
    image,
    hidden,
    instructions,
    plugins,
  }: {
    agentId: string;
    name: string;
    description?: string;
    image?: string;
    hidden?: boolean;
    instructions: string;
    plugins: PluginRef[];
  }): Promise<void> => {
    assertAgentIdFormat(agentId);
    const agentDir = resolvePath(path.join(getAgentsRootDir(), agentId));
    const agentMdPath = path.join(agentDir, 'AGENT.md');

    try {
      await fs.access(agentMdPath);
      throw new Error(`Agent "${agentId}" already exists`);
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        // proceed
      } else if (error instanceof Error && error.message.includes('already exists')) {
        throw error;
      } else {
        throw error;
      }
    }

    await fs.mkdir(agentDir, { recursive: true });

    const data: Record<string, unknown> = {
      name,
      description,
      plugins: serializePluginRefs(plugins),
    };
    if (typeof image === 'string' && image.trim() !== '') {
      data.image = image.trim();
    }
    if (hidden === true) {
      data.hidden = true;
    }

    const body = matter.stringify(`${instructions.trim()}\n`, data);
    await fs.writeFile(agentMdPath, body, 'utf-8');
  },
  updateAgent: async ({
    agentId,
    name,
    description,
    image,
    hidden,
    instructions,
    plugins,
  }: {
    agentId: string;
    name?: string;
    description?: string;
    image?: string;
    hidden?: boolean;
    instructions?: string;
    plugins?: PluginRef[];
  }): Promise<void> => {
    assertAgentIdFormat(agentId);
    const agentDir = resolvePath(path.join(getAgentsRootDir(), agentId));
    const agentMdPath = path.join(agentDir, 'AGENT.md');

    let raw: string;
    try {
      raw = await fs.readFile(agentMdPath, 'utf-8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        if (!isBuiltinOverlayAgentId(agentId)) {
          const err = new Error(`Agent "${agentId}" does not exist.`);
          (err as Error & { code?: string }).code = 'AGENT_NOT_FOUND';
          throw err;
        }
        raw = '';
      } else {
        throw error;
      }
    }

    const parsed = raw === '' ? { data: {}, content: '' } : matter(raw);
    const nextData: Record<string, unknown> = { ...parsed.data };
    if (name !== undefined) nextData.name = name;
    if (description !== undefined) nextData.description = description;
    if (plugins !== undefined) nextData.plugins = serializePluginRefs(plugins);
    if (image !== undefined) {
      if (typeof image === 'string' && image.trim() !== '') {
        nextData.image = image.trim();
      } else {
        delete nextData.image;
      }
    }
    if (hidden !== undefined) {
      if (hidden) {
        nextData.hidden = true;
      } else {
        delete nextData.hidden;
      }
    }

    const nextContent = instructions !== undefined ? instructions : parsed.content;
    const body = matter.stringify(`${String(nextContent).trim()}\n`, nextData);
    await fs.mkdir(path.dirname(agentMdPath), { recursive: true });
    await fs.writeFile(agentMdPath, body, 'utf-8');
  },
  deleteAgent: async ({ agentId }: { agentId: string }): Promise<void> => {
    assertAgentIdFormat(agentId);
    const agentDir = resolvePath(path.join(getAgentsRootDir(), agentId));
    const agentMdPath = path.join(agentDir, 'AGENT.md');
    const packageJsonPath = path.join(agentDir, 'package.json');

    if (isBuiltinOverlayAgentId(agentId)) {
      try {
        await fs.access(agentMdPath);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
          const err = new Error(
            `Agent "${agentId}" has no AGENT.md on disk; nothing to remove (defaults already apply).`,
          );
          (err as Error & { code?: string }).code = 'AGENT_NOT_FOUND';
          throw err;
        }
        throw error;
      }
      await fs.unlink(agentMdPath);
      try {
        const remaining = await fs.readdir(agentDir);
        if (remaining.length === 0) {
          await fs.rmdir(agentDir);
        }
      } catch {
        // ignore cleanup failures
      }
      return;
    }

    try {
      await fs.access(agentDir);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        const err = new Error(`Agent "${agentId}" does not exist.`);
        (err as Error & { code?: string }).code = 'AGENT_NOT_FOUND';
        throw err;
      }
      throw error;
    }

    let hasPackage = false;
    let hasAgentMd = false;
    try {
      await fs.access(packageJsonPath);
      hasPackage = true;
    } catch {
      // ignore
    }
    try {
      await fs.access(agentMdPath);
      hasAgentMd = true;
    } catch {
      // ignore
    }

    if (hasPackage && !hasAgentMd) {
      throw new Error(
        `Cannot delete TypeScript agent package "${agentId}" through this action; remove the folder manually.`,
      );
    }
    if (!hasAgentMd) {
      throw new Error(
        `Agent "${agentId}" has no AGENT.md and cannot be deleted through this action.`,
      );
    }

    await fs.rm(agentDir, { recursive: true, force: true });
  },
  getEvents: async ({
    channelId,
    threadId,
  }: {
    channelId: string;
    threadId?: string;
  }): Promise<OpenBotEvent[]> => {
    try {
      const threadDir = getConversationDir(channelId, threadId);
      const eventsPath = `${threadDir}/events.jsonl`;
      const eventsData = await fs.readFile(eventsPath);

      const events = eventsData
        .toString()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const event = JSON.parse(line) as OpenBotEvent;
          if (!event.id) {
            event.id = crypto.randomUUID();
          }
          return event;
        });

      if (!threadId) {
        const threadsDir = resolvePath(
          resolveBaseDir() + '/' + DEFAULT_CHANNELS_DIR + '/' + channelId + '/threads',
        );
        try {
          const threadDirs = await fs.readdir(threadsDir);
          const threadSet = new Set(threadDirs);

          return events.map((event) => {
            const eventThreadId = event.id;
            if (eventThreadId && threadSet.has(eventThreadId)) {
              return {
                ...event,
                meta: {
                  ...(event.meta || {}),
                  hasThread: true,
                },
              };
            }
            return event;
          });
        } catch {
          return events;
        }
      }

      return events;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.error(`Failed to get events for channel ${channelId} thread ${threadId}`, error);
      }
      return [];
    }
  },
  storeEvent: async ({
    channelId,
    threadId,
    event,
  }: {
    channelId: string;
    threadId?: string;
    event: OpenBotEvent;
  }): Promise<void> => {
    try {
      const threadDir = getConversationDir(channelId, threadId);
      if (threadId) {
        let exists = false;
        try {
          await fs.access(threadDir);
          exists = true;
        } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
            const threadTitle = buildThreadTitleFromEvent(event);
            await storageService.createThread({
              channelId,
              threadId,
              threadTitle,
            });
          } else {
            throw error;
          }
        }

        if (exists) {
          // If the thread already exists, check if it has a name.
          // This handles threads created via action:create_thread without a title.
          const threadDetails = await storageService.getThreadDetails({ channelId, threadId });
          const currentState = (threadDetails.state as Record<string, unknown>) || {};
          if (!currentState.name) {
            const threadTitle = buildThreadTitleFromEvent(event);
            if (threadTitle) {
              await storageService.patchThreadState({
                channelId,
                threadId,
                state: { name: threadTitle },
              });
            }
          }
        }
      } else {
        await fs.mkdir(threadDir, { recursive: true });
      }

      if (!event.id) {
        event.id = crypto.randomUUID();
      }

      await fs.appendFile(`${threadDir}/events.jsonl`, `${JSON.stringify(event)}\n`);
    } catch (error) {
      console.error(`Failed to store event for channel ${channelId} thread ${threadId}`, error);
      throw error;
    }
  },
  getVariables: async (): Promise<Record<string, string | { value: string; secret: boolean }>> => {
    const variablesFilePath = resolvePath(resolveBaseDir() + '/' + VARIABLES_FILE);
    const raw = await readJsonFile<unknown>(variablesFilePath, {});

    if (
      raw &&
      typeof raw === 'object' &&
      'variables' in raw &&
      Array.isArray((raw as { variables: unknown }).variables)
    ) {
      const entries = ((raw as { variables: StoredVariable[] }).variables)
        .filter((v) => typeof v?.key === 'string')
        .map((v) => [v.key, { value: String(v.value ?? ''), secret: !!v.secret }] as const);
      return Object.fromEntries(entries);
    }

    return toVariablesRecord(raw);
  },

  createVariable: async ({
    key,
    value,
    secret = false,
  }: {
    key: string;
    value: string;
    secret?: boolean;
  }): Promise<void> => {
    const variablesFilePath = resolvePath(resolveBaseDir() + '/' + VARIABLES_FILE);
    const raw = await readJsonFile<unknown>(variablesFilePath, { version: 1, variables: [] });

    let variables: StoredVariable[] = [];
    if (
      raw &&
      typeof raw === 'object' &&
      'variables' in raw &&
      Array.isArray((raw as { variables: unknown }).variables)
    ) {
      variables = (raw as { variables: StoredVariable[] }).variables;
    } else {
      variables = Object.entries(toVariablesRecord(raw)).map(([k, v]) => ({
        key: k,
        value: v,
        secret: false,
      }));
    }

    const existingIndex = variables.findIndex((v) => v.key === key);
    if (existingIndex !== -1) {
      variables[existingIndex] = { key, value, secret };
    } else {
      variables.push({ key, value, secret });
    }

    await fs.mkdir(path.dirname(variablesFilePath), { recursive: true });
    await fs.writeFile(
      variablesFilePath,
      JSON.stringify({ version: 1, variables }, null, 2),
      'utf-8',
    );
    processService.syncWorkspaceVariablesToProcessEnv();
  },

  deleteVariable: async ({ key }: { key: string }): Promise<void> => {
    const variablesFilePath = resolvePath(resolveBaseDir() + '/' + VARIABLES_FILE);
    const raw = await readJsonFile<unknown>(variablesFilePath, { version: 1, variables: [] });

    let variables: StoredVariable[] = [];
    if (
      raw &&
      typeof raw === 'object' &&
      'variables' in raw &&
      Array.isArray((raw as { variables: unknown }).variables)
    ) {
      variables = (raw as { variables: StoredVariable[] }).variables;
    } else {
      variables = Object.entries(toVariablesRecord(raw)).map(([k, v]) => ({
        key: k,
        value: v,
        secret: false,
      }));
    }

    const newVariables = variables.filter((v) => v.key !== key);

    if (newVariables.length === variables.length) {
      return;
    }

    await fs.mkdir(path.dirname(variablesFilePath), { recursive: true });
    await fs.writeFile(
      variablesFilePath,
      JSON.stringify({ version: 1, variables: newVariables }, null, 2),
      'utf-8',
    );
    processService.syncWorkspaceVariablesToProcessEnv();
  },

  listFiles: async ({
    channelId,
    path: subPath = '',
  }: {
    channelId: string;
    path?: string;
  }): Promise<Array<{ name: string; isDirectory: boolean }>> => {
    const details = await storageService.getChannelDetails({ channelId });
    const baseCwd = details.cwd;

    if (!baseCwd) {
      throw new Error('Channel has no CWD configured');
    }

    const resolvedBase = path.resolve(baseCwd);
    const targetDir = path.resolve(resolvedBase, subPath);

    if (!targetDir.startsWith(resolvedBase)) {
      throw new Error('Access denied: directory escape');
    }

    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
      }));
  },

  readFile: async ({
    channelId,
    path: filePath,
  }: {
    channelId: string;
    path: string;
  }): Promise<string> => {
    const details = await storageService.getChannelDetails({ channelId });
    const baseCwd = details.cwd;

    if (!baseCwd) {
      throw new Error('Channel has no CWD configured');
    }

    const resolvedBase = path.resolve(baseCwd);
    const targetFile = path.resolve(resolvedBase, filePath);

    if (!targetFile.startsWith(resolvedBase)) {
      throw new Error('Access denied: directory escape');
    }

    return fs.readFile(targetFile, 'utf-8');
  },

  appendMemory: memoryService.appendMemory,
  listMemories: memoryService.listMemories,
  deleteMemory: memoryService.deleteMemory,
  updateMemory: memoryService.updateMemory,

  /**
   * Hydrates the full OpenBot state from disk/storage before a run.
   */
  getOpenBotState: async (options: {
    runId: string;
    agentId: string;
    channelId: string;
    threadId?: string;
    event: OpenBotEvent;
  }): Promise<OpenBotState> => {
    const { runId, agentId, channelId, threadId, event } = options;

    let agentDetails: AgentDetails;
    try {
      agentDetails = await storageService.getAgentDetails({ agentId });
    } catch (error) {
      console.warn(`[storage] Failed to load agent details for agent: ${agentId}`, error);
      throw error;
    }

    let channelDetails;
    if (channelId) {
      try {
        channelDetails = await storageService.getChannelDetails({ channelId });
      } catch (error) {
        console.warn(`[storage] Failed to load channel details for channel ${channelId}`, error);
      }
    }

    let threadDetails;
    if (channelId && threadId) {
      try {
        threadDetails = await storageService.getThreadDetails({ channelId, threadId });
      } catch (error) {
        console.warn(
          `[storage] Failed to load thread details for channel ${channelId} thread: ${threadId}`,
          error,
        );
      }
    }

    return {
      runId,
      agentId,
      channelId,
      threadId,
      triggerEvent: event,
      agentDetails: {
        id: agentDetails.id,
        name: agentDetails.name,
        description: agentDetails.description || '',
        image: agentDetails.image,
        instructions: agentDetails.instructions || '',
        plugins: agentDetails.plugins,
        pluginRefs: agentDetails.pluginRefs,
        createdAt: agentDetails.createdAt,
        updatedAt: agentDetails.updatedAt,
      } satisfies AgentDetails,
      channelDetails: channelDetails as ChannelDetails,
      threadDetails: threadDetails as ThreadDetails,
    };
  },
};
