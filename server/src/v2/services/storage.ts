import {
  DEFAULT_AGENT_MD,
  DEFAULT_AGENTS_DIR,
  DEFAULT_BASE_DIR,
  DEFAULT_CHANNELS_DIR,
  DEFAULT_PLUGINS_DIR,
  loadConfig,
  resolvePath,
  VARIABLES_FILE,
} from '../app/config.js';
import fs from 'node:fs/promises';
import matter from 'gray-matter';
import { Agent, AgentDetails, Channel, ChannelDetails, Plugin } from '../plugins/storage.js';
import { OpenBotEvent } from '../app/types.js';
import { pathToFileURL } from 'node:url';

const mapNameToPlugin = (name: string, description: string): Plugin => ({
  id: name,
  name,
  description,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const resolveBaseDir = () => {
  const config = loadConfig();
  return resolvePath(config.baseDir || DEFAULT_BASE_DIR);
};

const listBuiltInPlugins = async (): Promise<Plugin[]> => {
  return [
    mapNameToPlugin('storage', 'Built-in storage plugin'),
    mapNameToPlugin('ai-sdk', 'Built-in AI SDK plugin'),
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
      return mapNameToPlugin(module.plugin.name || entry.name, module.plugin.description || '');
    });

  return Promise.all(plugins);
};

export const storageService = {
  getChannels: async (): Promise<Channel[]> => {
    const channelsDir = resolvePath(resolveBaseDir() + '/' + DEFAULT_CHANNELS_DIR);
    try {
      await fs.access(channelsDir);
    } catch {
      await fs.mkdir(channelsDir, { recursive: true });
    }

    const channels = (await fs.readdir(channelsDir)).filter((name) => !name.startsWith('.'));

    return channels.map((channel) => ({
      id: channel,
      name: channel,
      description: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  },
  getChannelDetails: async ({ threadId }: { threadId: string }): Promise<ChannelDetails> => {
    const threadDir = resolvePath(resolveBaseDir() + '/' + DEFAULT_CHANNELS_DIR + '/' + threadId);
    const specPath = `${threadDir}/SPEC.md`;
    const statePath = `${threadDir}/state.json`;

    try {
      await fs.access(specPath);
    } catch {
      await fs.mkdir(threadDir, { recursive: true });
      await fs.writeFile(specPath, '');
    }

    try {
      await fs.access(statePath);
    } catch {
      await fs.mkdir(threadDir, { recursive: true });
      await fs.writeFile(statePath, '{}');
    }

    const channelSpec = await fs.readFile(specPath);
    const channelState = await fs.readFile(statePath);

    return {
      id: threadId,
      name: threadId,
      spec: channelSpec.toString(),
      state: JSON.parse(channelState.toString()),
    };
  },
  patchChannelState: async ({
    threadId,
    state: patch,
  }: {
    threadId: string;
    state: unknown;
  }): Promise<void> => {
    const threadDir = resolvePath(resolveBaseDir() + '/' + DEFAULT_CHANNELS_DIR + '/' + threadId);
    const statePath = `${threadDir}/state.json`;

    try {
      // 1. Fetch current details to get the existing state
      const currentDetails = await storageService.getChannelDetails({ threadId });
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
      console.error(`Failed to patch channel state for thread ${threadId}`, error);
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

    const agents = (await fs.readdir(agentsDir)).filter((name) => !name.startsWith('.'));

    return agents.map((agent) => ({
      id: agent,
      name: agent,
      description: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
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
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(agentMdPath, DEFAULT_AGENT_MD);
    }

    try {
      const agentMd = await fs.readFile(agentMdPath, 'utf-8');
      const { data, content: instructions } = matter(agentMd);

      return {
        id: agentId,
        name: data.name || agentId,
        instructions: instructions.trim(),
        plugins: data.plugins || [],
        description: data.description || '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } catch (error) {
      console.error(`Failed to read agent MD file for agent ${agentId}`);
      return {
        id: agentId,
        name: agentId,
        instructions: DEFAULT_AGENT_MD,
        plugins: [],
        description: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
  },
  getEvents: async ({ threadId }: { threadId: string }): Promise<OpenBotEvent[]> => {
    try {
      const events = await fs.readFile(
        resolvePath(
          resolveBaseDir() + '/' + DEFAULT_CHANNELS_DIR + '/' + threadId + '/events.jsonl',
        ),
      );

      return events
        .toString()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as OpenBotEvent);
    } catch (error) {
      console.error(`Failed to get events for thread ${threadId}`);
      return [];
    }
  },
  storeEvent: async ({
    threadId,
    event,
  }: {
    threadId: string;
    event: OpenBotEvent;
  }): Promise<void> => {
    try {
      const threadDir = resolvePath(resolveBaseDir() + '/' + DEFAULT_CHANNELS_DIR + '/' + threadId);
      await fs.mkdir(threadDir, { recursive: true });
      await fs.appendFile(`${threadDir}/events.jsonl`, `${JSON.stringify(event)}\n`);
    } catch (error) {
      console.error(`Failed to store event for thread ${threadId}`, error);
    }
  },
  getVariables: async (): Promise<Record<string, string>> => {
    const variables = await fs.readFile(resolvePath(resolveBaseDir() + '/' + VARIABLES_FILE));

    return JSON.parse(variables.toString()) as Record<string, string>;
  },
};
