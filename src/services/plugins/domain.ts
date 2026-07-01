import type { OpenBotEvent } from '../../app/types.js';
import type { PluginRef } from './types.js';
import type { MemoryRecord, ListMemoriesArgs } from '../../plugins/memory/service.js';

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
  createChannel: (args: {
    channelId: string;
    spec?: string;
    initialState?: Record<string, unknown>;
    cwd?: string;
  }) => Promise<void>;
  /** Idempotent channel setup; repairs partial dirs missing cwd/state. */
  ensureChannel: (args: {
    channelId: string;
    spec?: string;
    initialState?: Record<string, unknown>;
    cwd?: string;
  }) => Promise<void>;
  /** Removes the channel directory and cleans up `_meta/last-read.json`. */
  deleteChannel: (args: { channelId: string }) => Promise<void>;
  createThread: (args: {
    channelId: string;
    threadId: string;
    threadTitle?: string;
    initialState?: Record<string, unknown>;
  }) => Promise<void>;
  getThreads: (args: { channelId: string }) => Promise<Thread[]>;
  getThreadDetails: (args: { channelId: string; threadId: string }) => Promise<ThreadDetails>;
  setLastRead: (args: { channelId: string; threadId?: string; lastReadEventId: string }) => Promise<void>;
  /** User-facing agent list; excludes agents with `hidden: true` (e.g. built-in `state`). */
  getAgents: () => Promise<Agent[]>;
  getPlugins: () => Promise<PluginDescriptor[]>;
  getAgentDetails: (args: { agentId: string }) => Promise<AgentDetails>;
  /** Includes built-in `system` / `state` agents as optional AGENT.md overlays. */
  createAgent: (args: {
    agentId: string;
    name: string;
    description?: string;
    /** Avatar/logo URL or data URI; persisted in AGENT.md frontmatter. */
    image?: string;
    /** When true, agent is omitted from `getAgents` / `action:storage:get-agents`. */
    hidden?: boolean;
    instructions: string;
    plugins: PluginRef[];
  }) => Promise<void>;
  /** Partial update; for `system` / `state`, creates overlay file if missing. */
  updateAgent: (args: {
    agentId: string;
    name?: string;
    description?: string;
    /** Omit to leave unchanged; empty string removes stored image. */
    image?: string;
    hidden?: boolean;
    instructions?: string;
    plugins?: PluginRef[];
  }) => Promise<void>;
  /** For `system` / `state`, removes only `AGENT.md` (reverts to code defaults). */
  deleteAgent: (args: { agentId: string }) => Promise<void>;
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
  getVariables: () => Promise<Record<string, string | { value: string; secret: boolean }>>;
  createVariable: (args: { key: string; value: string; secret?: boolean }) => Promise<void>;
  deleteVariable: (args: { key: string }) => Promise<void>;
  listFiles: (args: {
    channelId: string;
    path?: string;
  }) => Promise<Array<{ name: string; isDirectory: boolean }>>;
  readFile: (args: { channelId: string; path: string }) => Promise<string>;
  readChannelFile: (args: {
    channelId: string;
    path: string;
    encoding?: 'utf8' | 'base64';
  }) => Promise<{ content: string; mimeType: string; size: number }>;
  writeChannelFile: (args: {
    channelId: string;
    path: string;
    content: string;
    encoding?: 'utf8' | 'base64';
    overwrite?: boolean;
  }) => Promise<{ path: string; size: number; mimeType: string }>;
  uploadChannelFile: (args: {
    channelId: string;
    path: string;
    body: Buffer;
    overwrite?: boolean;
  }) => Promise<{ path: string; size: number; mimeType: string }>;
  getChannelFileStat: (args: {
    channelId: string;
    path: string;
  }) => Promise<{ abs: string; size: number; mimeType: string }>;
  /** Persist a memory record into the global memory log. */
  appendMemory: (args: {
    scope: string;
    content: string;
    tags?: string[];
  }) => Promise<MemoryRecord>;
  /** Read memories matching the given filter. */
  listMemories: (args?: ListMemoriesArgs) => Promise<MemoryRecord[]>;
  /** Soft-delete a memory by id. Returns true if a record was deleted. */
  deleteMemory: (args: { id: string }) => Promise<boolean>;
  /** Update a memory's content/tags by id. Returns true if a record was updated. */
  updateMemory: (args: { id: string; content?: string; tags?: string[] }) => Promise<boolean>;
}
