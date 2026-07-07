import type { OpenBotEvent } from '../../app/types.js';
import type { PluginRef } from './types.js';

/**
 * Public data types exposed by the OpenBot platform.
 *
 * The platform layer owns channels, threads, the agent registry, and the event
 * stream. Agents are composed entirely of Plugins (see `./types.ts`); their
 * internal implementation is opaque to the platform.
 */

export type Agent = {
  id: string;
  name: string;
  description: string;
  image?: string;
  /** Plugin ids that compose this agent (mirrors AGENT.md `plugins[].id`). */
  plugins: string[];
  /** When true, omitted from `action:storage:get-agents` (still available via get-agent-details). */
  hidden?: boolean;
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
  configSchema?: ConfigSchema;
  createdAt: Date;
  updatedAt: Date;
};

export type ConfigSchema = {
  type: 'object';
  properties: {
    [key: string]: {
      type: 'string' | 'number' | 'boolean' | 'integer' | 'object' | 'array';
      description?: string;
      default?: unknown;
      enum?: unknown[];
      /** Labeled select options (preferred over bare `enum` when present). */
      options?: Array<{ label: string; value: string; description?: string }>;
      minimum?: number;
      maximum?: number;
      format?: 'password' | 'url' | 'email';
      properties?: ConfigSchema['properties'];
      items?: ConfigSchema['properties'][string];
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
  hasUnseenMessages?: boolean;
};

/** Persisted thread `state.json` fields (additional keys are allowed). */
export type ThreadState = {
  name?: string;
  /** Sticky agent id for this thread (`system` = orchestrator). Set once, then enforced on publish. */
  respondingAgentId?: string;
  pendingToolCallIds?: string[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  [key: string]: unknown;
};

export type ThreadDetails = {
  id: string;
  name: string;
  channelId: string;
  state: ThreadState;
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
  ensureChannel: (args: {
    channelId: string;
    spec?: string;
    initialState?: Record<string, unknown>;
    cwd?: string;
  }) => Promise<void>;
  createThread: (args: {
    channelId: string;
    threadId: string;
    threadTitle?: string;
    initialState?: Record<string, unknown>;
  }) => Promise<void>;
  getThreads: (args: { channelId: string }) => Promise<Thread[]>;
  getThreadDetails: (args: { channelId: string; threadId: string }) => Promise<ThreadDetails>;
  setLastRead: (args: { channelId: string; threadId?: string; lastReadEventId: string }) => Promise<void>;
  getAgents: () => Promise<Agent[]>;
  getPlugins: () => Promise<PluginDescriptor[]>;
  getAgentDetails: (args: { agentId: string }) => Promise<AgentDetails>;
  getEvents: (args: { channelId: string; threadId?: string }) => Promise<OpenBotEvent[]>;
  storeEvent: (args: {
    channelId: string;
    threadId?: string;
    event: OpenBotEvent;
  }) => Promise<void>;
  getChannelDetails: (args: { channelId: string }) => Promise<ChannelDetails>;
  patchChannelState: (args: { channelId: string; state: unknown }) => Promise<void>;
  patchThreadState: (args: {
    channelId: string;
    threadId: string;
    state: unknown;
  }) => Promise<void>;
  patchChannelSpec: (args: { channelId: string; spec: string }) => Promise<void>;
}
