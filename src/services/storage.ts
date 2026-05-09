import {
  DEFAULT_AGENT_PACKAGES_DIR,
  DEFAULT_AGENTS_DIR,
  DEFAULT_BASE_DIR,
  DEFAULT_CHANNELS_DIR,
  loadConfig,
  resolvePath,
  StoredVariable,
  VARIABLES_FILE,
} from '../app/config.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import {
  Agent,
  AgentDetails,
  AgentPackageDescriptor,
  Channel,
  ChannelDetails,
  Thread,
  ThreadDetails,
} from '../bus/types.js';
import { openBotAgentPackage } from '../agents/openbot/index.js';
import { OPENBOT_SYSTEM_PROMPT } from '../agents/openbot/system-prompt.js';
import { listBuiltInAgentPackages, parseAgentPackageModule } from '../registry/agents.js';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import { processService } from '../harness/process.js';
import { pathToFileURL } from 'node:url';

const resolveBaseDir = () => {
  const config = loadConfig();
  return resolvePath(config.baseDir || DEFAULT_BASE_DIR);
};

const ENTITY_SVG_CANDIDATE_NAMES = ['avatar.svg', 'icon.svg', 'image.svg', 'logo.svg'] as const;

const toSvgDataUrl = (svg: string) =>
  `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;

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

/**
 * Auto-discovers an entity SVG avatar and returns it as a data URL.
 *
 * Search order:
 * 1) <entity>/assets/avatar.svg|icon.svg|image.svg|logo.svg
 * 2) <entity>/avatar.svg|icon.svg|image.svg|logo.svg
 * 3) first *.svg in <entity>/assets
 * 4) first *.svg in <entity>
 */
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
      // ignore missing/unreadable folders
    }
  }

  return undefined;
};

const getConversationDir = (channelId: string, threadId?: string) => {
  const base = resolvePath(resolveBaseDir() + '/' + DEFAULT_CHANNELS_DIR + '/' + channelId);
  return threadId ? `${base}/threads/${threadId}` : base;
};

/** Built-in orchestrator agent id. Not creatable as a normal disk agent (`agents/<id>/AGENT.md`). */
const SYSTEM_AGENT_ID = 'system';

function getSystemAgentDetails(overrides?: Partial<AgentDetails>): AgentDetails {
  const defaults: AgentDetails = {
    id: SYSTEM_AGENT_ID,
    name: openBotAgentPackage.name,
    image: openBotAgentPackage.image,
    description: openBotAgentPackage.description,
    instructions: OPENBOT_SYSTEM_PROMPT,
    packageId: openBotAgentPackage.id,
    config: { model: 'openai/gpt-5.4-nano' },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  if (!overrides) return defaults;

  return {
    ...defaults,
    ...overrides,
    id: SYSTEM_AGENT_ID,
    image: overrides.image || defaults.image,
    config: { ...(defaults.config || {}), ...(overrides.config || {}) },
    updatedAt: new Date(),
  };
}

const RESERVED_DISK_AGENT_IDS = new Set([SYSTEM_AGENT_ID]);

const assertValidDiskAgentId = (agentId: string): void => {
  if (!agentId || typeof agentId !== 'string') {
    throw new Error('agentId is required');
  }
  if (RESERVED_DISK_AGENT_IDS.has(agentId)) {
    throw new Error(`Agent id "${agentId}" is reserved`);
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

  if (event.type === 'user:input' && typeof event.data?.content === 'string') {
    rawContent = event.data.content;
  } else if (
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

  // Current format: { version: number, variables: StoredVariable[] }
  if ('variables' in raw && Array.isArray((raw as { variables?: unknown }).variables)) {
    const entries = (raw as { variables: StoredVariable[] }).variables
      .filter((variable) => typeof variable?.key === 'string')
      .map((variable) => [variable.key, String(variable.value ?? '')] as const);
    return Object.fromEntries(entries);
  }

  // Legacy format: { [key: string]: string }
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).map(([key, value]) => [
      key,
      String(value ?? ''),
    ]),
  );
};

const listBuiltInAgentPackageDescriptors = async (): Promise<AgentPackageDescriptor[]> => {
  return listBuiltInAgentPackages().map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    image: pkg.image,
    defaultInstructions: pkg.defaultInstructions,
    configSchema: pkg.configSchema,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
};

/**
 * Walk `agent-packages/` and yield candidate package ids (npm names). Includes
 * scoped packages by recursing one level into directories starting with `@`.
 */
const listInstalledPackageIds = async (packagesDir: string): Promise<string[]> => {
  const out: string[] = [];
  let topEntries;
  try {
    topEntries = await fs.readdir(packagesDir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of topEntries) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    if (entry.name.startsWith('@')) {
      try {
        const inner = await fs.readdir(path.join(packagesDir, entry.name), { withFileTypes: true });
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

const listAgentPackagesFromDisk = async (): Promise<AgentPackageDescriptor[]> => {
  const packagesDir = resolvePath(resolveBaseDir() + '/' + DEFAULT_AGENT_PACKAGES_DIR);
  try {
    await fs.access(packagesDir);
  } catch {
    await fs.mkdir(packagesDir, { recursive: true });
  }

  const ids = await listInstalledPackageIds(packagesDir);

  const descriptors = await Promise.all(
    ids.map(async (id): Promise<AgentPackageDescriptor | null> => {
      try {
        const packageDir = path.join(packagesDir, id);
        const distPath = path.join(packageDir, 'dist', 'index.js');
        const module = await import(pathToFileURL(distPath).href);
        const parsed = parseAgentPackageModule(module as Record<string, unknown>);
        if (!parsed) return null;
        const image = await resolveEntityImageDataUrl(packageDir);
        return {
          id,
          name: parsed.name || id,
          description: parsed.description || '',
          image: parsed.image || image,
          defaultInstructions: parsed.defaultInstructions,
          configSchema: parsed.configSchema,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      } catch (error) {
        console.warn(`[storage] Failed to load agent package ${id}:`, error);
        return null;
      }
    }),
  );

  return descriptors.filter((d): d is AgentPackageDescriptor => d !== null);
};

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

        try {
          const stateContent = await fs.readFile(statePath, 'utf-8');
          const state = JSON.parse(stateContent);
          cwd = typeof state.cwd === 'string' ? state.cwd : undefined;
        } catch {
          // Ignore if state.json is missing or invalid
        }

        const channel: Channel = {
          id: name,
          name: name,
          description: '',
          cwd,
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
          // Fetch up to 5 most recent threads for the sidebar
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
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    const finalState = {
      ...(initialState || {}),
    };

    if (cwd) {
      finalState.cwd = cwd;
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
    spec,
    initialState,
  }: {
    channelId: string;
    threadId: string;
    threadTitle?: string;
    spec?: string;
    initialState?: Record<string, unknown>;
  }): Promise<void> => {
    const normalizedChannelId = channelId.trim();
    const normalizedThreadId = threadId.trim();

    if (!normalizedChannelId) {
      throw new Error('channelId is required');
    }
    if (!normalizedThreadId) {
      throw new Error('threadId is required');
    }

    const threadDir = getConversationDir(normalizedChannelId, normalizedThreadId);
    const specPath = `${threadDir}/SPEC.md`;
    const statePath = `${threadDir}/state.json`;

    try {
      await fs.access(threadDir);
      throw new Error(
        `Thread "${normalizedThreadId}" already exists in channel "${normalizedChannelId}"`,
      );
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    const baseState = { ...(initialState || {}) };
    if (threadTitle?.trim()) {
      baseState.generatedName = threadTitle.trim();
    }

    await fs.mkdir(threadDir, { recursive: true });
    await fs.writeFile(
      specPath,
      spec?.trim() ||
        `# ${normalizedThreadId}\n\nDefine the goals and plan for this thread here.\n`,
    );
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
          const generatedName =
            typeof threadState.generatedName === 'string' ? threadState.generatedName.trim() : '';
          if (generatedName) {
            threadDisplayName = generatedName;
          }
        } catch (error: any) {
          if (error.code !== 'ENOENT') {
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
    const specPath = `${threadDir}/SPEC.md`;
    const statePath = `${threadDir}/state.json`;

    let spec = '';
    try {
      spec = await fs.readFile(specPath, 'utf-8');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(
          `Failed to read thread spec for channel ${channelId} thread ${threadId}`,
          error,
        );
      }
    }

    let state = {};
    try {
      const stateContent = await fs.readFile(statePath, 'utf-8');
      state = JSON.parse(stateContent);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(
          `Failed to read thread state for channel ${channelId} thread ${threadId}`,
          error,
        );
      }
    }

    const generatedName =
      typeof (state as Record<string, unknown>).generatedName === 'string'
        ? ((state as Record<string, unknown>).generatedName as string).trim()
        : '';

    return {
      id: threadId,
      name: generatedName || threadId,
      channelId,
      spec,
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
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(`Failed to read spec file for channel ${channelId}`, error);
      }
    }

    let state = {};
    try {
      const stateContent = await fs.readFile(statePath, 'utf-8');
      state = JSON.parse(stateContent);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(`Failed to read state file for channel ${channelId}`, error);
      }
    }

    const details: ChannelDetails = {
      id: channelId,
      name: channelId,
      spec,
      state,
      cwd: typeof (state as any).cwd === 'string' ? (state as any).cwd : undefined,
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
      // 1. Fetch current details to get the existing state
      const currentDetails = await storageService.getChannelDetails({ channelId });
      const currentState = (currentDetails.state as Record<string, unknown>) || {};

      // 2. Perform a shallow merge (patch)
      const newState = {
        ...currentState,
        ...(patch as Record<string, unknown>),
      };

      // 3. Write back the merged state
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
      // 1. Fetch current details to get the existing state
      const currentDetails = await storageService.getThreadDetails({ channelId, threadId });
      const currentState = (currentDetails.state as Record<string, unknown>) || {};

      // 2. Perform a shallow merge (patch)
      const newState = {
        ...currentState,
        ...(patch as Record<string, unknown>),
      };

      // 3. Write back the merged state
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
  patchThreadSpec: async ({
    channelId,
    threadId,
    spec,
  }: {
    channelId: string;
    threadId: string;
    spec: string;
  }): Promise<void> => {
    const threadDir = getConversationDir(channelId, threadId);
    const specPath = `${threadDir}/SPEC.md`;

    try {
      await fs.mkdir(threadDir, { recursive: true });
      await fs.writeFile(specPath, spec);
    } catch (error) {
      console.error(
        `Failed to patch thread spec for channel ${channelId} thread ${threadId}`,
        error,
      );
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
          return {
            id,
            name: details.name || id,
            description: details.description || '',
            image: details.image,
            packageId: details.packageId,
            createdAt: details.createdAt,
            updatedAt: details.updatedAt,
          } satisfies Agent;
        } catch {
          return {
            id,
            name: id,
            description: '',
            packageId: '',
            createdAt: new Date(),
            updatedAt: new Date(),
          } satisfies Agent;
        }
      }),
    );

    const system = await storageService.getAgentDetails({ agentId: SYSTEM_AGENT_ID });
    const builtInSystemAgent: Agent = {
      id: system.id,
      name: system.name,
      description: system.description || '',
      image: system.image,
      packageId: system.packageId,
      createdAt: system.createdAt,
      updatedAt: system.updatedAt,
    };

    const deduped = new Map<string, Agent>();
    deduped.set(builtInSystemAgent.id, builtInSystemAgent);
    for (const agent of agents) {
      if (!deduped.has(agent.id)) deduped.set(agent.id, agent);
    }

    return Array.from(deduped.values());
  },
  getAgentPackages: async (): Promise<AgentPackageDescriptor[]> => {
    const [builtIn, fromDisk] = await Promise.all([
      listBuiltInAgentPackageDescriptors(),
      listAgentPackagesFromDisk(),
    ]);

    const merged = [...builtIn, ...fromDisk];
    const deduped = new Map<string, AgentPackageDescriptor>();
    for (const pkg of merged) {
      if (!deduped.has(pkg.id)) {
        deduped.set(pkg.id, pkg);
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

      diskDetails = {
        id: agentId,
        name: data.name || agentId,
        instructions: instructions.trim(),
        packageId: typeof data.packageId === 'string' ? data.packageId : 'openbot',
        config: (data.config as Record<string, unknown> | undefined) || {},
        description: data.description || '',
        image: discoveredImage || undefined,
        createdAt: stats.birthtime,
        updatedAt: stats.mtime,
      };
    } catch (error) {
      if (agentId !== SYSTEM_AGENT_ID) {
        const err = new Error(`Agent "${agentId}" does not exist.`);
        (err as Error & { code?: string }).code = 'AGENT_NOT_FOUND';
        throw err;
      }
    }

    if (agentId === SYSTEM_AGENT_ID) {
      return getSystemAgentDetails(diskDetails);
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
    instructions,
    packageId,
    config,
  }: {
    agentId: string;
    name: string;
    description?: string;
    instructions: string;
    packageId: string;
    config?: AgentDetails['config'];
  }): Promise<void> => {
    assertValidDiskAgentId(agentId);
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

    const data: Record<string, unknown> = { name, description, packageId };
    if (config !== undefined) data.config = config;

    const body = matter.stringify(`${instructions.trim()}\n`, data);
    await fs.writeFile(agentMdPath, body, 'utf-8');
  },
  updateAgent: async ({
    agentId,
    name,
    description,
    instructions,
    packageId,
    config,
  }: {
    agentId: string;
    name?: string;
    description?: string;
    instructions?: string;
    packageId?: string;
    config?: AgentDetails['config'];
  }): Promise<void> => {
    assertValidDiskAgentId(agentId);
    const agentDir = resolvePath(path.join(getAgentsRootDir(), agentId));
    const agentMdPath = path.join(agentDir, 'AGENT.md');

    let raw: string;
    try {
      raw = await fs.readFile(agentMdPath, 'utf-8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        const err = new Error(`Agent "${agentId}" does not exist.`);
        (err as Error & { code?: string }).code = 'AGENT_NOT_FOUND';
        throw err;
      }
      throw error;
    }

    const parsed = matter(raw);
    const nextData: Record<string, unknown> = { ...parsed.data };
    if (name !== undefined) nextData.name = name;
    if (description !== undefined) nextData.description = description;
    if (packageId !== undefined) nextData.packageId = packageId;
    if (config !== undefined) nextData.config = config;

    const nextContent = instructions !== undefined ? instructions : parsed.content;
    const body = matter.stringify(`${String(nextContent).trim()}\n`, nextData);
    await fs.writeFile(agentMdPath, body, 'utf-8');
  },
  deleteAgent: async ({ agentId }: { agentId: string }): Promise<void> => {
    assertValidDiskAgentId(agentId);
    const agentDir = resolvePath(path.join(getAgentsRootDir(), agentId));
    const agentMdPath = path.join(agentDir, 'AGENT.md');
    const packageJsonPath = path.join(agentDir, 'package.json');

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

      // If we are at the channel level (no threadId), check which events have threads
      if (!threadId) {
        const threadsDir = resolvePath(
          resolveBaseDir() + '/' + DEFAULT_CHANNELS_DIR + '/' + channelId + '/threads',
        );
        try {
          const threadDirs = await fs.readdir(threadsDir);
          const threadSet = new Set(threadDirs);

          return events.map((event) => {
            // Check if this event has a threadId associated with it
            // The frontend provides the threadId, and it matches the directory name on disk
            const threadId = event.id;

            // If an explicit threadId exists and has a directory, use it
            if (threadId && threadSet.has(threadId)) {
              return {
                ...event,
                meta: {
                  ...(event as any)?.meta,
                  hasThread: true,
                },
              };
            }

            return event;
          });
        } catch {
          // No threads folder or other error, just return events as is
          return events;
        }
      }

      return events;
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
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
        try {
          await fs.access(threadDir);
        } catch (error: any) {
          if (error.code === 'ENOENT') {
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
      } else {
        await fs.mkdir(threadDir, { recursive: true });
      }

      // Ensure the event has a unique ID
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
    const raw = await readJsonFile<any>(variablesFilePath, {});

    if (raw && typeof raw === 'object' && 'variables' in raw && Array.isArray(raw.variables)) {
      const entries = (raw.variables as StoredVariable[])
        .filter((v) => typeof v?.key === 'string')
        .map((v) => [v.key, { value: String(v.value ?? ''), secret: !!v.secret }] as const);
      return Object.fromEntries(entries);
    }

    // Legacy or simple format
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
    const raw = await readJsonFile<any>(variablesFilePath, { version: 1, variables: [] });

    let variables: StoredVariable[] = [];
    if (raw && typeof raw === 'object' && 'variables' in raw && Array.isArray(raw.variables)) {
      variables = raw.variables as StoredVariable[];
    } else {
      // Convert legacy format to new format
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
    const raw = await readJsonFile<any>(variablesFilePath, { version: 1, variables: [] });

    let variables: StoredVariable[] = [];
    if (raw && typeof raw === 'object' && 'variables' in raw && Array.isArray(raw.variables)) {
      variables = raw.variables as StoredVariable[];
    } else {
      // Convert legacy format to new format
      variables = Object.entries(toVariablesRecord(raw)).map(([k, v]) => ({
        key: k,
        value: v,
        secret: false,
      }));
    }

    const newVariables = variables.filter((v) => v.key !== key);

    if (newVariables.length === variables.length) {
      return; // Nothing to delete
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

    // Security check: ensure target is within baseCwd
    if (!targetDir.startsWith(resolvedBase)) {
      throw new Error('Access denied: directory escape');
    }

    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith('.')) // Hide hidden files by default for MVP
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

    // Security check: ensure target is within baseCwd
    if (!targetFile.startsWith(resolvedBase)) {
      throw new Error('Access denied: directory escape');
    }

    return fs.readFile(targetFile, 'utf-8');
  },

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
        packageId: agentDetails.packageId,
        config: agentDetails.config,
        createdAt: agentDetails.createdAt,
        updatedAt: agentDetails.updatedAt,
      } satisfies AgentDetails,
      channelDetails: channelDetails as ChannelDetails,
      threadDetails: threadDetails as ThreadDetails,
    };
  },
};
