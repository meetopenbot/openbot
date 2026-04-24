import {
  DEFAULT_AGENTS_DIR,
  DEFAULT_BASE_DIR,
  DEFAULT_CHANNELS_DIR,
  DEFAULT_PLUGINS_DIR,
  loadConfig,
  resolvePath,
  VARIABLES_FILE,
} from '../app/config.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import {
  Agent,
  AgentDetails,
  Channel,
  ChannelDetails,
  Plugin,
  PluginKind,
  Thread,
  ThreadDetails,
} from '../plugins/storage.js';
import { getSystemAgentDetails } from '../agents/system.js';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import { pathToFileURL } from 'node:url';

const mapNameToPlugin = (
  name: string,
  description: string,
  kind: PluginKind = 'tool',
  image?: string,
): Plugin => ({
  id: name,
  name,
  description,
  kind,
  image,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const resolveBaseDir = () => {
  const config = loadConfig();
  return resolvePath(config.baseDir || DEFAULT_BASE_DIR);
};

const ENTITY_SVG_CANDIDATE_NAMES = ['avatar.svg', 'icon.svg', 'image.svg', 'logo.svg'] as const;

const toSvgDataUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;

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
      const firstSvg = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.svg'));
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

const getLastReadFilePath = () =>
  path.join(
    resolvePath(resolveBaseDir() + '/' + DEFAULT_CHANNELS_DIR),
    '_meta',
    'last-read.json',
  );

const readJsonFile = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T;
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === 'ENOENT') return fallback;
    throw e;
  }
};

const listBuiltInPlugins = async (): Promise<Plugin[]> => {
  return [
    mapNameToPlugin('storage', 'Built-in storage plugin'),
    mapNameToPlugin('ai-sdk', 'Built-in AI SDK plugin', 'runtime'),
    mapNameToPlugin('threads', 'Built-in threads plugin'),
    mapNameToPlugin('delegation', 'Built-in delegation plugin'),
  ];
};

const listPluginsFromDisk = async (): Promise<Plugin[]> => {
  const pluginsDir = resolvePath(resolveBaseDir() + '/' + DEFAULT_PLUGINS_DIR);
  try {
    await fs.access(pluginsDir);
  } catch {
    await fs.mkdir(pluginsDir, { recursive: true });
  }

  const plugins = (await fs.readdir(pluginsDir, { withFileTypes: true }))
    .filter(
      (entry) => !entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink()),
    )
    .map(async (entry) => {
      // get dist/index module and find inside module.plugin.description
      const module = await import(pathToFileURL(`${pluginsDir}/${entry.name}/dist/index.js`).href);
      const pluginDir = path.join(pluginsDir, entry.name);
      const image = await resolveEntityImageDataUrl(pluginDir);
      return mapNameToPlugin(
        module.plugin.name || entry.name,
        module.plugin.description || '',
        module.plugin.kind || 'tool',
        image,
      );
    });

  return Promise.all(plugins);
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
        const channel: Channel = {
          id: name,
          name: name,
          description: '',
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
  }: {
    channelId: string;
    spec?: string;
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

    await fs.mkdir(channelDir, { recursive: true });
    await fs.writeFile(
      specPath,
      spec?.trim() || `# ${normalizedChannelId}\n\nDefine the goals and rules for this channel here.\n`,
    );
    await fs.writeFile(statePath, JSON.stringify({}, null, 2));
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
            console.error(`Failed to read thread state for channel ${channelId} thread ${name}`, error);
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
        console.error(`Failed to read thread spec for channel ${channelId} thread ${threadId}`, error);
      }
    }

    let state = {};
    try {
      const stateContent = await fs.readFile(statePath, 'utf-8');
      state = JSON.parse(stateContent);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(`Failed to read thread state for channel ${channelId} thread ${threadId}`, error);
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
      console.error(`Failed to patch thread spec for channel ${channelId} thread ${threadId}`, error);
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
            runtime: details.runtime,
            createdAt: details.createdAt,
            updatedAt: details.updatedAt,
          };
        } catch {
          return {
            id,
            name: id,
            description: '',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
      }),
    );

    const system = getSystemAgentDetails();
    const builtInSystemAgent: Agent = {
      id: system.id,
      name: system.name,
      description: system.description || '',
      image: system.image,
      runtime: system.runtime,
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
  getPlugins: async (): Promise<Plugin[]> => {
    const [builtInPlugins, diskPlugins] = await Promise.all([
      listBuiltInPlugins(),
      listPluginsFromDisk(),
    ]);

    const merged = [...builtInPlugins, ...diskPlugins];
    const deduped = new Map<string, Plugin>();
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

    try {
      await fs.access(agentMdPath);
    } catch {
      const error = new Error(`Agent "${agentId}" does not exist.`);
      (error as Error & { code?: string }).code = 'AGENT_NOT_FOUND';
      throw error;
    }

    try {
      const agentMd = await fs.readFile(agentMdPath, 'utf-8');
      const { data, content: instructions } = matter(agentMd);
      const discoveredImage = await resolveEntityImageDataUrl(agentDir);

      return {
        id: agentId,
        name: data.name || agentId,
        instructions: instructions.trim(),
        runtime: data.runtime,
        plugins: data.plugins || [],
        description: data.description || '',
        image: discoveredImage,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } catch (error) {
      console.error(`Failed to read agent MD file for agent ${agentId}`, error);
      throw error;
    }
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
      await fs.mkdir(threadDir, { recursive: true });

      // Ensure the event has a unique ID
      if (!event.id) {
        event.id = crypto.randomUUID();
      }

      await fs.appendFile(`${threadDir}/events.jsonl`, `${JSON.stringify(event)}\n`);
    } catch (error) {
      console.error(`Failed to store event for channel ${channelId} thread ${threadId}`, error);
    }
  },
  getVariables: async (): Promise<Record<string, string>> => {
    const variables = await fs.readFile(resolvePath(resolveBaseDir() + '/' + VARIABLES_FILE));

    return JSON.parse(variables.toString()) as Record<string, string>;
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
    if (agentId === 'system') {
      agentDetails = getSystemAgentDetails();
    } else {
      try {
        agentDetails = await storageService.getAgentDetails({ agentId });
      } catch (error) {
        console.warn(`[storage] Failed to load agent details for agent: ${agentId}`, error);
        throw error;
      }
    }

    let channelDetails;
    if (channelId && channelId !== 'default') {
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
      agentDetails: agentDetails as AgentDetails,
      channelDetails: channelDetails as ChannelDetails,
      threadDetails: threadDetails as ThreadDetails,
    };
  },
};
