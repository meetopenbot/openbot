import { ORCHESTRATOR_AGENT_ID, STATE_AGENT_ID } from '../../app/agent-ids.js';
import {
  DEFAULT_AGENTS_DIR,
  DEFAULT_CHANNELS_DIR,
  getBaseDir,
  getDefaultChannelCwd,
  resolvePath,
} from '../../app/config.js';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  ThreadState,
} from '../../services/plugins/domain.js';
import type { PluginRef } from '../../services/plugins/types.js';
import { openbotPlugin } from '../openbot/index.js';
import { listBuiltInPlugins } from '../../services/plugins/registry.js';
import {
  enrichOpenbotPluginDescriptor,
  listRegistryModelOptions,
} from '../../services/plugins/model-registry.js';
import { OpenBotEvent, OpenBotState } from '../../app/types.js';

const SYSTEM_AGENT_ID = ORCHESTRATOR_AGENT_ID;

const SYSTEM_DEFAULT_PLUGINS: PluginRef[] = [
  {
    id: 'openbot',
    config: { model: 'openai/gpt-4o-mini' },
  },
];

const STATE_DEFAULT_PLUGINS: PluginRef[] = [{ id: 'storage' }];

const STATE_AGENT_INSTRUCTIONS =
  'Built-in infra agent for deterministic state reads. No conversational model is attached.';

const getConversationDir = (channelId: string, threadId?: string) => {
  const base = resolvePath(`${getBaseDir()}/${DEFAULT_CHANNELS_DIR}/${channelId}`);
  return threadId ? `${base}/threads/${threadId}` : base;
};

const readJsonFile = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    const content = (await fs.readFile(filePath, 'utf-8')).trim();
    if (!content) return fallback;
    return JSON.parse(content) as T;
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === 'ENOENT') return fallback;
    if (e instanceof SyntaxError) return fallback;
    throw e;
  }
};

const writeJsonFileAtomically = async (filePath: string, data: unknown): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, filePath);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

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

let bundledSystemAgentImage: string | undefined;
let bundledSystemAgentImageLoaded = false;

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
    bundledSystemAgentImage = `data:image/svg+xml;base64,${Buffer.from(trimmed, 'utf-8').toString('base64')}`;
  } catch {
    bundledSystemAgentImage = undefined;
  }
  return bundledSystemAgentImage;
}

function getSystemAgentDetails(overrides?: Partial<AgentDetails>): AgentDetails {
  const defaults: AgentDetails = {
    id: SYSTEM_AGENT_ID,
    name: 'OpenBot',
    image: getBundledSystemAgentImage(),
    description: 'First-party orchestration agent for OpenBot.',
    instructions: '',
    plugins: SYSTEM_DEFAULT_PLUGINS.map((ref) => ref.id),
    pluginRefs: SYSTEM_DEFAULT_PLUGINS,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  if (!overrides) return defaults;
  const refs =
    overrides.pluginRefs && overrides.pluginRefs.length > 0
      ? overrides.pluginRefs
      : defaults.pluginRefs;
  return {
    ...defaults,
    ...overrides,
    id: SYSTEM_AGENT_ID,
    instructions: overrides.instructions?.trim() || defaults.instructions,
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
    description: 'Infrastructure agent for OpenBot — storage without an LLM.',
    instructions: STATE_AGENT_INSTRUCTIONS,
    plugins: STATE_DEFAULT_PLUGINS.map((ref) => ref.id),
    pluginRefs: STATE_DEFAULT_PLUGINS,
    hidden: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  if (!overrides) return defaults;
  const refs =
    overrides.pluginRefs && overrides.pluginRefs.length > 0
      ? overrides.pluginRefs
      : defaults.pluginRefs;
  return {
    ...defaults,
    ...overrides,
    id: STATE_AGENT_ID,
    instructions: overrides.instructions?.trim() || defaults.instructions,
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

const getLastReadFilePath = () =>
  path.join(resolvePath(`${getBaseDir()}/${DEFAULT_CHANNELS_DIR}`), '_meta', 'last-read.json');

export const ROOT_THREAD_KEY = '__root__';

const readLastReadMap = async (): Promise<Record<string, Record<string, string>>> => {
  const raw = await readJsonFile<Record<string, unknown>>(getLastReadFilePath(), {});
  const map: Record<string, Record<string, string>> = {};
  for (const [channelId, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      map[channelId] = { [ROOT_THREAD_KEY]: value };
    } else if (value && typeof value === 'object') {
      map[channelId] = value as Record<string, string>;
    }
  }
  return map;
};

const buildThreadTitleFromEvent = (event: OpenBotEvent): string | undefined => {
  if (
    event.type !== 'agent:invoke' ||
    event.data?.role !== 'user' ||
    typeof event.data.content !== 'string'
  ) {
    return undefined;
  }
  const normalized = event.data.content.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 80).trimEnd()}...`;
};

const isChannelProvisioned = async (channelId: string): Promise<boolean> => {
  const state = await readJsonFile<Record<string, unknown>>(
    `${getConversationDir(channelId)}/state.json`,
    {},
  );
  return typeof state.cwd === 'string' && state.cwd.trim().length > 0;
};

void openbotPlugin;

export const storageService = {
  setLastRead: async ({
    channelId,
    threadId,
    lastReadEventId,
  }: {
    channelId: string;
    threadId?: string;
    lastReadEventId: string;
  }): Promise<void> => {
    const p = getLastReadFilePath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    const map = await readLastReadMap();
    if (!map[channelId]) map[channelId] = {};
    map[channelId][threadId || ROOT_THREAD_KEY] = lastReadEventId;
    await writeJsonFileAtomically(p, map);
  },

  getChannels: async (): Promise<Channel[]> => {
    const channelsDir = resolvePath(`${getBaseDir()}/${DEFAULT_CHANNELS_DIR}`);
    await fs.mkdir(channelsDir, { recursive: true });
    const names = (await fs.readdir(channelsDir)).filter(
      (name) => !name.startsWith('.') && name !== '_meta',
    );

    const channels: Channel[] = [];
    for (const name of names) {
      const state = await readJsonFile<Record<string, unknown>>(
        `${getConversationDir(name)}/state.json`,
        {},
      );
      const cwd = typeof state.cwd === 'string' ? state.cwd : undefined;
      if (!cwd) continue;
      const stats = await fs.stat(getConversationDir(name));
      channels.push({
        id: name,
        name: typeof state.name === 'string' && state.name.trim() ? state.name.trim() : name,
        description: '',
        cwd,
        createdAt: stats.birthtime,
        updatedAt: stats.mtime,
      });
    }
    return channels.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  },

  ensureChannel: async ({
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
    const id = channelId.trim();
    if (!id) throw new Error('channelId is required');

    const channelDir = getConversationDir(id);
    const statePath = `${channelDir}/state.json`;
    const specPath = `${channelDir}/SPEC.md`;
    const existing = await readJsonFile<Record<string, unknown>>(statePath, {});

    if (typeof existing.cwd === 'string' && existing.cwd.trim()) {
      await fs.mkdir(resolvePath(existing.cwd), { recursive: true });
      return;
    }

    const finalState: Record<string, unknown> = { ...existing, ...(initialState || {}) };
    const resolvedCwd = resolvePath(
      (typeof cwd === 'string' && cwd.trim()) ||
        (typeof finalState.cwd === 'string' && finalState.cwd.trim()) ||
        getDefaultChannelCwd(id),
    );
    finalState.cwd = resolvedCwd;

    await fs.mkdir(resolvedCwd, { recursive: true });
    await fs.mkdir(channelDir, { recursive: true });
    try {
      await fs.access(specPath);
    } catch {
      await fs.writeFile(specPath, spec?.trim() || `# ${id}\n\n`);
    }
    await writeJsonFileAtomically(statePath, finalState);
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
    const threadDir = getConversationDir(channelId.trim(), threadId.trim());
    try {
      await fs.access(threadDir);
      throw new Error(`Thread "${threadId}" already exists`);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    }
    const state: Record<string, unknown> = { ...(initialState || {}) };
    if (threadTitle?.trim()) state.name = threadTitle.trim();
    await writeJsonFileAtomically(`${threadDir}/state.json`, state);
  },

  getThreads: async ({ channelId }: { channelId: string }): Promise<Thread[]> => {
    const threadsDir = `${getConversationDir(channelId)}/threads`;
    try {
      await fs.access(threadsDir);
    } catch {
      return [];
    }
    const names = (await fs.readdir(threadsDir)).filter((n) => !n.startsWith('.'));
    const threads: Thread[] = [];
    for (const name of names) {
      const threadDir = path.join(threadsDir, name);
      const stats = await fs.stat(threadDir);
      const state = await readJsonFile<Record<string, unknown>>(`${threadDir}/state.json`, {});
      const displayName =
        typeof state.name === 'string' && state.name.trim() ? state.name.trim() : name;
      threads.push({
        id: name,
        name: displayName,
        channelId,
        createdAt: stats.birthtime,
        updatedAt: stats.mtime,
      });
    }
    return threads;
  },

  getThreadDetails: async ({
    channelId,
    threadId,
  }: {
    channelId: string;
    threadId: string;
  }): Promise<ThreadDetails> => {
    const state = await readJsonFile<Record<string, unknown>>(
      `${getConversationDir(channelId, threadId)}/state.json`,
      {},
    );
    const name =
      typeof state.name === 'string' && state.name.trim() ? state.name.trim() : threadId;
    return {
      id: threadId,
      name,
      channelId,
      state: state as ThreadState,
    };
  },

  getChannelDetails: async ({ channelId }: { channelId: string }): Promise<ChannelDetails> => {
    const channelDir = getConversationDir(channelId);
    let spec = '';
    try {
      spec = await fs.readFile(`${channelDir}/SPEC.md`, 'utf-8');
    } catch {
      // optional
    }
    const state = await readJsonFile<Record<string, unknown>>(`${channelDir}/state.json`, {});
    const cwd = typeof state.cwd === 'string' ? state.cwd : undefined;
    const name =
      typeof state.name === 'string' && state.name.trim() ? state.name.trim() : channelId;
    return {
      id: channelId,
      name,
      spec,
      state,
      cwd,
      threads: await storageService.getThreads({ channelId }),
    };
  },

  patchChannelState: async ({
    channelId,
    state: patch,
  }: {
    channelId: string;
    state: unknown;
  }): Promise<void> => {
    const current = await storageService.getChannelDetails({ channelId });
    const next = { ...((current.state as Record<string, unknown>) || {}), ...(patch as object) };
    await writeJsonFileAtomically(`${getConversationDir(channelId)}/state.json`, next);
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
    const current = await storageService.getThreadDetails({ channelId, threadId });
    const next = { ...((current.state as Record<string, unknown>) || {}), ...(patch as object) };
    await writeJsonFileAtomically(`${getConversationDir(channelId, threadId)}/state.json`, next);
  },

  patchChannelSpec: async ({ channelId, spec }: { channelId: string; spec: string }): Promise<void> => {
    const channelDir = getConversationDir(channelId);
    await fs.mkdir(channelDir, { recursive: true });
    await fs.writeFile(`${channelDir}/SPEC.md`, spec);
  },

  getEvents: async ({
    channelId,
    threadId,
  }: {
    channelId: string;
    threadId?: string;
  }): Promise<OpenBotEvent[]> => {
    try {
      const eventsPath = `${getConversationDir(channelId, threadId)}/events.jsonl`;
      const raw = await fs.readFile(eventsPath, 'utf-8');
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const event = JSON.parse(line) as OpenBotEvent;
          if (!event.id) event.id = crypto.randomUUID();
          return event;
        });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.error(`[storage] getEvents failed for ${channelId}/${threadId ?? 'root'}`, error);
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
    if (!(await isChannelProvisioned(channelId))) return;

    const threadDir = getConversationDir(channelId, threadId);
    if (threadId) {
      try {
        await fs.access(threadDir);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
          await storageService.createThread({
            channelId,
            threadId,
            threadTitle: buildThreadTitleFromEvent(event),
          });
        } else {
          throw error;
        }
      }
    } else {
      await fs.mkdir(threadDir, { recursive: true });
    }

    if (!event.id) event.id = crypto.randomUUID();
    await fs.appendFile(`${threadDir}/events.jsonl`, `${JSON.stringify(event)}\n`);
  },

  getAgents: async (): Promise<Agent[]> => {
    const agentsDir = resolvePath(`${getBaseDir()}/${DEFAULT_AGENTS_DIR}`);
    await fs.mkdir(agentsDir, { recursive: true });
    const ids = (await fs.readdir(agentsDir)).filter((n) => !n.startsWith('.'));

    const deduped = new Map<string, Agent>();
    deduped.set(SYSTEM_AGENT_ID, agentSummaryFromDetails(getSystemAgentDetails()));
    deduped.set(STATE_AGENT_ID, agentSummaryFromDetails(getStateAgentDetails()));

    for (const id of ids) {
      if (id === SYSTEM_AGENT_ID || id === STATE_AGENT_ID) continue;
      try {
        deduped.set(id, agentSummaryFromDetails(await storageService.getAgentDetails({ agentId: id })));
      } catch {
        // skip invalid agents
      }
    }

    return Array.from(deduped.values()).filter((a) => !a.hidden);
  },

  getPlugins: async (): Promise<PluginDescriptor[]> => {
    const modelOptions = await listRegistryModelOptions();
    return listBuiltInPlugins().map((plugin) => {
      const descriptor: PluginDescriptor = {
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        builtIn: true,
        image: plugin.image,
        configSchema: plugin.configSchema,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return enrichOpenbotPluginDescriptor(descriptor, modelOptions);
    });
  },

  getAgentDetails: async ({ agentId }: { agentId: string }): Promise<AgentDetails> => {
    const agentMdPath = resolvePath(`${getBaseDir()}/${DEFAULT_AGENTS_DIR}/${agentId}/AGENT.md`);
    let diskDetails: Partial<AgentDetails> | undefined;

    try {
      const agentMd = await fs.readFile(agentMdPath, 'utf-8');
      const { data, content } = matter(agentMd);
      const stats = await fs.stat(agentMdPath);
      const pluginRefs = parsePluginRefs(data.plugins);
      diskDetails = {
        id: agentId,
        name: typeof data.name === 'string' ? data.name : agentId,
        instructions: content.trim(),
        plugins: pluginRefs.map((ref) => ref.id),
        pluginRefs,
        description: typeof data.description === 'string' ? data.description : '',
        image: typeof data.image === 'string' ? data.image : undefined,
        hidden: data.hidden === true ? true : undefined,
        createdAt: stats.birthtime,
        updatedAt: stats.mtime,
      };
    } catch (error: unknown) {
      if (agentId !== SYSTEM_AGENT_ID && agentId !== STATE_AGENT_ID) {
        const err = new Error(`Agent "${agentId}" does not exist.`);
        (err as Error & { code?: string }).code = 'AGENT_NOT_FOUND';
        throw err;
      }
      void error;
    }

    if (agentId === SYSTEM_AGENT_ID) return getSystemAgentDetails(diskDetails);
    if (agentId === STATE_AGENT_ID) return getStateAgentDetails(diskDetails);
    if (!diskDetails) {
      const err = new Error(`Agent "${agentId}" does not exist.`);
      (err as Error & { code?: string }).code = 'AGENT_NOT_FOUND';
      throw err;
    }
    return diskDetails as AgentDetails;
  },

  getOpenBotState: async (options: {
    runId: string;
    agentId: string;
    channelId: string;
    threadId?: string;
    event: OpenBotEvent;
  }): Promise<OpenBotState> => {
    const { runId, agentId, channelId, threadId, event } = options;
    const agentDetails = await storageService.getAgentDetails({ agentId });

    let channelDetails;
    let threadDetails;
    try {
      channelDetails = await storageService.getChannelDetails({ channelId });
    } catch {
      // channel may not exist yet
    }
    if (threadId) {
      try {
        threadDetails = await storageService.getThreadDetails({ channelId, threadId });
      } catch {
        // thread may not exist yet
      }
    }

    return {
      agentId,
      runId,
      channelId,
      threadId,
      agentDetails,
      channelDetails,
      threadDetails,
      triggerEvent: event,
    };
  },
};
