import type { OpenBotEvent } from '../app/types.js';
import type { PluginRef } from './plugin.js';

/**
 * Public data types exposed by the OpenBot bus.
 *
 * The bus is the platform layer that owns channels, threads, the agent registry,
 * and the event stream. Agents are composed entirely of Plugins (see
 * `bus/plugin.ts`); their internal implementation is opaque to the bus.
 */

export type Agent = {
  id: string;
  name: string;
  description: string;
  image?: string;
  /** Plugin ids that compose this agent (mirrors AGENT.md `plugins[].id`). */
  plugins: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type AgentDetails = Agent & {
  instructions: string;
  /** Full plugin refs from AGENT.md (with per-plugin config). */
  pluginRefs: PluginRef[];
};

export type PluginDescriptor = {
  id: string;
  name: string;
  description: string;
  /** True when bundled with the core server (`src/registry/plugins`); false for ~/.openbot/plugins installs. */
  builtIn: boolean;
  image?: string;
  defaultInstructions?: string;
  configSchema?: ConfigSchema;
  createdAt: Date;
  updatedAt: Date;
};

export type ConfigSchema = {
  type: 'object';
  properties: {
    [key: string]: {
      type: 'string' | 'number' | 'boolean' | 'integer';
      description?: string;
      default?: unknown;
      enum?: unknown[];
      minimum?: number;
      maximum?: number;
      format?: 'password' | 'url' | 'email';
    };
  };
  required?: string[];
};

export type Channel = {
  id: string;
  name: string;
  description: string;
  cwd?: string;
  createdAt: Date;
  updatedAt: Date;
  hasUnseenMessages?: boolean;
  recentThreads?: Thread[];
};

export type Thread = {
  id: string;
  name: string;
  channelId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ThreadDetails = {
  id: string;
  name: string;
  channelId: string;
  spec: string;
  state: unknown;
};

export type ChannelDetails = {
  id: string;
  name: string;
  spec: string;
  state: unknown;
  cwd?: string;
  threads?: Thread[];
};

export interface Storage {
  getChannels: () => Promise<Channel[]>;
  createChannel: (args: {
    channelId: string;
    spec?: string;
    initialState?: Record<string, unknown>;
    cwd?: string;
  }) => Promise<void>;
  createThread: (args: {
    channelId: string;
    threadId: string;
    threadTitle?: string;
    spec?: string;
    initialState?: Record<string, unknown>;
  }) => Promise<void>;
  getThreads: (args: { channelId: string }) => Promise<Thread[]>;
  getThreadDetails: (args: { channelId: string; threadId: string }) => Promise<ThreadDetails>;
  getAgents: () => Promise<Agent[]>;
  getPlugins: () => Promise<PluginDescriptor[]>;
  getAgentDetails: (args: { agentId: string }) => Promise<AgentDetails>;
  createAgent: (args: {
    agentId: string;
    name: string;
    description?: string;
    instructions: string;
    plugins: PluginRef[];
  }) => Promise<void>;
  updateAgent: (args: {
    agentId: string;
    name?: string;
    description?: string;
    instructions?: string;
    plugins?: PluginRef[];
  }) => Promise<void>;
  deleteAgent: (args: { agentId: string }) => Promise<void>;
  getEvents: (args: { channelId: string; threadId?: string }) => Promise<OpenBotEvent[]>;
  getChannelDetails: (args: { channelId: string }) => Promise<ChannelDetails>;
  patchChannelState: (args: { channelId: string; state: unknown }) => Promise<void>;
  patchThreadState: (args: {
    channelId: string;
    threadId: string;
    state: unknown;
  }) => Promise<void>;
  patchChannelSpec: (args: { channelId: string; spec: string }) => Promise<void>;
  patchThreadSpec: (args: { channelId: string; threadId: string; spec: string }) => Promise<void>;
  getVariables: () => Promise<Record<string, string | { value: string; secret: boolean }>>;
  createVariable: (args: { key: string; value: string; secret?: boolean }) => Promise<void>;
  deleteVariable: (args: { key: string }) => Promise<void>;
  listFiles: (args: {
    channelId: string;
    path?: string;
  }) => Promise<Array<{ name: string; isDirectory: boolean }>>;
  readFile: (args: { channelId: string; path: string }) => Promise<string>;
}
