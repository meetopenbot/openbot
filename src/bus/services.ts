import { MelonyPlugin } from 'melony';
import { DEFAULT_MARKETPLACE_REGISTRY_URL, loadConfig } from '../app/config.js';
import { OpenBotEvent, OpenBotState, MemoryScopeAlias } from '../app/types.js';
import type { PluginRef } from './plugin.js';
import { Storage } from './types.js';
import { storageService } from '../services/storage.js';
import { pluginService } from '../services/plugins.js';

/**
 * Resolve a scope alias to a concrete scope string. Aliases let tools accept
 * `agent`/`channel`/`global` without knowing the active ids; the bus rewrites
 * them using `context.state`.
 */
function resolveMemoryScope(
  alias: MemoryScopeAlias | undefined,
  state: OpenBotState,
): string {
  switch (alias) {
    case 'agent':
      return `agent:${state.agentId}`;
    case 'channel':
      return `channel:${state.channelId}`;
    case 'global':
    case undefined:
      return 'global';
    default:
      return 'global';
  }
}

function resolveMemoryScopeFilter(
  alias: MemoryScopeAlias | 'all' | undefined,
  state: OpenBotState,
): string[] | undefined {
  if (alias === 'all' || alias === undefined) {
    return ['global', `agent:${state.agentId}`, `channel:${state.channelId}`];
  }
  return [resolveMemoryScope(alias, state)];
}

/** One marketplace entry; matches `action:marketplace:list:result` agent shape. */
export type MarketplaceAgentListing = {
  id: string;
  name: string;
  description: string;
  image?: string;
  instructions: string;
  plugins: PluginRef[];
};

const DEFAULT_MARKETPLACE_AGENTS: MarketplaceAgentListing[] = [
  {
    id: 'researcher',
    name: 'Researcher',
    description: 'Specialized in web research and information synthesis.',
    instructions:
      'You are a research assistant. Use available tools to find information.',
    plugins: [
      { id: 'ai-sdk', config: { model: 'openai/gpt-4o' } },
      { id: 'mcp' },
      { id: 'shell' },
    ],
  },
  {
    id: 'coder',
    name: 'Coder',
    description: 'Expert in multiple programming languages and software architecture.',
    instructions: 'You are an expert software engineer. Help the user with coding tasks.',
    plugins: [{ id: 'claude-code' }],
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses JSON from a remote registry file. Supports either
 * `{ "agents": [ ... ] }` or a top-level array.
 */
export function parseMarketplaceRegistryJson(data: unknown): MarketplaceAgentListing[] {
  const rawAgents: unknown =
    Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.agents) ? data.agents : null;
  if (!Array.isArray(rawAgents)) {
    throw new Error('Registry JSON must be an array or an object with an "agents" array');
  }
  return rawAgents.map((item, i) => {
    if (!isRecord(item)) {
      throw new Error(`agents[${i}]: expected object`);
    }
    const id = item.id;
    const name = item.name;
    const description = item.description;
    const instructions = item.instructions;
    const pluginsRaw = item.plugins;
    if (typeof id !== 'string' || !id) throw new Error(`agents[${i}].id must be a non-empty string`);
    if (typeof name !== 'string') throw new Error(`agents[${i}].name must be a string`);
    if (typeof description !== 'string') throw new Error(`agents[${i}].description must be a string`);
    if (typeof instructions !== 'string') {
      throw new Error(`agents[${i}].instructions must be a string`);
    }
    if (!Array.isArray(pluginsRaw)) throw new Error(`agents[${i}].plugins must be an array`);
    const plugins: PluginRef[] = pluginsRaw.map((p, j) => {
      if (!isRecord(p) || typeof p.id !== 'string' || !p.id) {
        throw new Error(`agents[${i}].plugins[${j}]: expected { "id": string, "config"?: object }`);
      }
      const ref: PluginRef = { id: p.id };
      if (p.config !== undefined) {
        if (!isRecord(p.config)) throw new Error(`agents[${i}].plugins[${j}].config must be an object`);
        ref.config = p.config;
      }
      return ref;
    });
    const listing: MarketplaceAgentListing = { id, name, description, instructions, plugins };
    if (item.image !== undefined) {
      if (typeof item.image !== 'string') throw new Error(`agents[${i}].image must be a string`);
      listing.image = item.image;
    }
    return listing;
  });
}

async function fetchMarketplaceAgentsFromUrl(url: string): Promise<MarketplaceAgentListing[]> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Registry HTTP ${res.status} ${res.statusText}`);
  }
  const json: unknown = await res.json();
  return parseMarketplaceRegistryJson(json);
}

/**
 * Bus-level service plugin.
 *
 * This handler bundle is registered once on every agent run and exposes the
 * platform's shared services (storage CRUD, channel/thread management, agent
 * registry, agent-package install/marketplace) over the event bus.
 *
 * Any agent (first-party OpenBot or community-built) can call into these
 * services purely by emitting `action:*` events with no per-agent wiring.
 */
export interface BusServicesOptions {
  storage: Storage;
}

export const busServicesPlugin =
  (options: BusServicesOptions): MelonyPlugin<OpenBotState, OpenBotEvent> =>
    (builder) => {
      const { storage } = options;

      builder.on('action:create_thread', async function* (event, context) {
        const threadId = event.meta?.threadId;
        const channelId = context.state.channelId;
        const { threadTitle, initialState } = (event as any).data;

        if (!threadId) {
          console.warn('[bus] Cannot create thread: meta.threadId is missing');
          return;
        }

        context.state.threadId = threadId;

        if (channelId) {
          try {
            await storage.createThread({
              channelId,
              threadId,
              threadTitle,
              initialState: (initialState as Record<string, unknown>) || {},
            });

            context.state.threadDetails = await storage.getThreadDetails({
              channelId,
              threadId,
            });
          } catch (error) {
            console.warn(
              `[bus] Failed to initialize thread for channel ${channelId} thread ${threadId}`,
              error,
            );
          }
        }

        yield {
          type: 'action:create_thread:result',
          data: { success: true, threadId, threadTitle },
          meta: { ...(event.meta || {}), threadId, agentId: context.state.agentId },
        } as OpenBotEvent;
      });

      builder.on('action:create_channel', async function* (event, context) {
        const { channelId, spec, initialState, cwd } = (event as any).data;
        const rawChannelId = (channelId || '').trim();
        const channelSpec = typeof spec === 'string' ? spec : '';

        const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };

        if (!rawChannelId) {
          yield {
            type: 'action:create_channel:result',
            data: { success: false, channelId: '', channelUrl: '' },
            meta: resultMeta,
          } as OpenBotEvent;
          return;
        }

        const channelUrl = `/channels/${rawChannelId}`;

        try {
          await storage.createChannel({
            channelId: rawChannelId,
            spec: channelSpec,
            initialState: initialState as Record<string, unknown>,
            cwd,
          });

          yield {
            type: 'action:create_channel:result',
            data: { success: true, channelId: rawChannelId, channelUrl },
            meta: resultMeta,
          } as OpenBotEvent;

          yield {
            type: 'agent:output',
            data: { content: `Created channel \`${rawChannelId}\`.` },
            meta: resultMeta,
          } as OpenBotEvent;
        } catch {
          yield {
            type: 'action:create_channel:result',
            data: { success: false, channelId: rawChannelId, channelUrl },
            meta: resultMeta,
          } as OpenBotEvent;
        }
      });

      builder.on('action:update_channel', async function* (event, context) {
        const data = (event.data || {}) as { channelId?: string; name?: string; cwd?: string };
        const targetChannelId = (data.channelId || context.state.channelId || '').trim();
        const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };

        if (!targetChannelId) {
          yield {
            type: 'action:update_channel:result',
            data: { success: false, channelId: '', updatedFields: [] as string[] },
            meta: resultMeta,
          } as OpenBotEvent;
          return;
        }

        const patch: Record<string, unknown> = {};
        const updatedFields: string[] = [];

        if (typeof data.name === 'string' && data.name.trim()) {
          patch.name = data.name.trim();
          updatedFields.push('name');
        }
        if (typeof data.cwd === 'string' && data.cwd.trim()) {
          patch.cwd = data.cwd.trim();
          updatedFields.push('cwd');
        }

        try {
          if (updatedFields.length > 0) {
            await storage.patchChannelState({ channelId: targetChannelId, state: patch });
          }

          if (targetChannelId === context.state.channelId) {
            context.state.channelDetails = await storage.getChannelDetails({
              channelId: context.state.channelId,
            });
          }

          yield {
            type: 'action:update_channel:result',
            data: { success: true, channelId: targetChannelId, updatedFields },
            meta: resultMeta,
          } as OpenBotEvent;
        } catch {
          yield {
            type: 'action:update_channel:result',
            data: { success: false, channelId: targetChannelId, updatedFields },
            meta: resultMeta,
          } as OpenBotEvent;
        }
      });

      builder.on('action:patch_channel_details', async function* (event, context) {
        const updatedFields: ('state' | 'spec' | 'cwd')[] = [];
        const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };
        try {
          if ((event.data as any).state !== undefined) {
            await storage.patchChannelState({
              channelId: context.state.channelId,
              state: (event.data as any).state,
            });
            updatedFields.push('state');
          }
          if (typeof (event.data as any).spec === 'string') {
            await storage.patchChannelSpec({
              channelId: context.state.channelId,
              spec: (event.data as any).spec,
            });
            updatedFields.push('spec');
          }
          if (typeof (event.data as any).cwd === 'string') {
            await storage.patchChannelState({
              channelId: context.state.channelId,
              state: { cwd: (event.data as any).cwd },
            });
            updatedFields.push('cwd');
          }

          context.state.channelDetails = await storage.getChannelDetails({
            channelId: context.state.channelId,
          });

          yield {
            type: 'action:patch_channel_details:result',
            data: { success: true, updatedFields },
            meta: resultMeta,
          };
        } catch {
          yield {
            type: 'action:patch_channel_details:result',
            data: { success: false, updatedFields },
            meta: resultMeta,
          };
        }
      });

      builder.on('action:patch_thread_details', async function* (event, context) {
        const updatedFields: ('state')[] = [];
        const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };
        try {
          if (!context.state.threadId) {
            throw new Error('Missing threadId in state for patch_thread_details');
          }
          if ((event.data as any).state !== undefined) {
            await storage.patchThreadState({
              channelId: context.state.channelId,
              threadId: context.state.threadId,
              state: (event.data as any).state,
            });
            updatedFields.push('state');
          }

          context.state.threadDetails = await storage.getThreadDetails({
            channelId: context.state.channelId,
            threadId: context.state.threadId,
          });

          yield {
            type: 'action:patch_thread_details:result',
            data: { success: true, updatedFields },
            meta: resultMeta,
          };
        } catch {
          yield {
            type: 'action:patch_thread_details:result',
            data: { success: false, updatedFields },
            meta: resultMeta,
          };
        }
      });

      builder.on('action:storage:get-channels', async function* () {
        const channels = await storage.getChannels();
        yield { type: 'action:storage:get-channels-result', data: { channels } };
      });

      builder.on('action:storage:get-threads', async function* (event) {
        const threads = await storage.getThreads({ channelId: event.data.channelId });
        yield { type: 'action:storage:get-threads-result', data: { threads } };
      });

      builder.on('action:storage:get-channel-details', async function* (_, state) {
        const channelDetails = await storage.getChannelDetails({
          channelId: state.state.channelId,
        });
        yield { type: 'action:storage:get-channel-details-result', data: { channelDetails } };
      });

      builder.on('action:storage:get-thread-details', async function* (_, state) {
        const threadId = state.state.threadId;
        const threadDetails = threadId
          ? await storage.getThreadDetails({ channelId: state.state.channelId, threadId })
          : null;
        yield { type: 'action:storage:get-thread-details-result', data: { threadDetails } };
      });

      builder.on('action:storage:get-agents', async function* () {
        const agents = await storage.getAgents();
        yield { type: 'action:storage:get-agents-result', data: { agents } };
      });

      builder.on('action:storage:get-plugins', async function* () {
        const plugins = await storage.getPlugins();
        yield { type: 'action:storage:get-plugins-result', data: { plugins } };
      });

      builder.on('action:storage:get-agent-details', async function* (event) {
        try {
          const agentDetails = await storage.getAgentDetails({ agentId: event.data.agentId });
          yield { type: 'action:storage:get-agent-details-result', data: { agentDetails } };
        } catch (error) {
          console.error(`[bus] Failed to get agent details for ${event.data.agentId}`, error);
          yield {
            type: 'action:storage:get-agent-details-result',
            data: {
              agentDetails: null as any,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          };
        }
      });

      builder.on('action:storage:create-agent', async function* (event) {
        try {
          const { agentId, name, description, instructions, plugins } = event.data;
          await storage.createAgent({ agentId, name, description, instructions, plugins });
          yield { type: 'action:storage:create-agent-result', data: { success: true } };
        } catch (error) {
          yield {
            type: 'action:storage:create-agent-result',
            data: {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          };
        }
      });

      builder.on('action:storage:update-agent', async function* (event) {
        try {
          const { agentId, name, description, instructions, plugins } = event.data;
          await storage.updateAgent({ agentId, name, description, instructions, plugins });
          yield { type: 'action:storage:update-agent-result', data: { success: true } };
        } catch (error) {
          yield {
            type: 'action:storage:update-agent-result',
            data: {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          };
        }
      });

      builder.on('action:storage:delete-agent', async function* (event) {
        try {
          await storage.deleteAgent({ agentId: event.data.agentId });
          yield { type: 'action:storage:delete-agent-result', data: { success: true } };
        } catch (error) {
          yield {
            type: 'action:storage:delete-agent-result',
            data: {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          };
        }
      });

      builder.on('action:storage:get-events', async function* (_, state) {
        const events = await storage.getEvents(state.state);
        if (!state.state.threadId && events.length > 0) {
          const lastId = events[events.length - 1]?.id;
          if (lastId) {
            await storageService.setLastReadForChannel({
              channelId: state.state.channelId,
              lastReadEventId: lastId,
            });
          }
        }
        yield { type: 'action:storage:get-events-result', data: { events } };
      });

      builder.on('action:storage:get-variables', async function* () {
        const variables = await storage.getVariables();
        const masked: Record<string, string> = {};
        for (const [key, val] of Object.entries(variables)) {
          if (typeof val === 'object' && val !== null && val.secret) {
            masked[key] = '********';
          } else {
            masked[key] = typeof val === 'string' ? val : val.value;
          }
        }
        yield {
          type: 'action:storage:get-variables-result',
          data: { variables: masked },
        } as OpenBotEvent;
      });

      builder.on('action:storage:create-variable', async function* (event) {
        try {
          const { key, value, secret } = event.data;
          await storage.createVariable({ key, value, secret });
          yield { type: 'action:storage:create-variable-result', data: { success: true } };
        } catch (error) {
          yield {
            type: 'action:storage:create-variable-result',
            data: {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          };
        }
      });

      builder.on('action:storage:delete-variable', async function* (event) {
        try {
          await storage.deleteVariable({ key: event.data.key });
          yield { type: 'action:storage:delete-variable-result', data: { success: true } };
        } catch (error) {
          yield {
            type: 'action:storage:delete-variable-result',
            data: {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          };
        }
      });

      builder.on('action:storage:patch-channel-state', async function* (event, state) {
        try {
          await storage.patchChannelState({
            channelId: state.state.channelId,
            state: event.data.state,
          });
          yield { type: 'action:storage:patch-channel-state-result', data: { success: true } };
        } catch {
          yield { type: 'action:storage:patch-channel-state-result', data: { success: false } };
        }
      });

      builder.on('action:storage:patch-thread-state', async function* (event, state) {
        try {
          if (!state.state.threadId) {
            throw new Error('Missing threadId in state for patch-thread-state');
          }
          await storage.patchThreadState({
            channelId: state.state.channelId,
            threadId: state.state.threadId,
            state: event.data.state,
          });
          yield { type: 'action:storage:patch-thread-state-result', data: { success: true } };
        } catch {
          yield { type: 'action:storage:patch-thread-state-result', data: { success: false } };
        }
      });

      builder.on('action:storage:list-files', async function* (event, context) {
        const channelId = context.state.channelId;
        const subPath = (event.data as any)?.path || '';
        try {
          const files = await storage.listFiles({ channelId, path: subPath });
          yield {
            type: 'action:storage:list-files:result',
            data: { success: true, files },
          };
        } catch (error) {
          yield {
            type: 'action:storage:list-files:result',
            data: {
              success: false,
              files: [],
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          };
        }
      });

      builder.on('action:storage:read-file', async function* (event, context) {
        const channelId = context.state.channelId;
        const filePath = (event.data as any)?.path;
        if (!filePath) {
          yield {
            type: 'action:storage:read-file:result',
            data: { success: false, path: '', error: 'Path is required' },
          };
          return;
        }
        try {
          const content = await storage.readFile({ channelId, path: filePath });
          yield {
            type: 'action:storage:read-file:result',
            data: { success: true, content, path: filePath },
          };
        } catch (error) {
          yield {
            type: 'action:storage:read-file:result',
            data: {
              success: false,
              path: filePath,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          };
        }
      });

      builder.on('action:plugin:install', async function* (event) {
        try {
          const { name, version } = event.data;
          const result = await pluginService.install({ packageName: name, version });
          yield {
            type: 'action:plugin:install:result',
            data: { success: true, plugin: result },
          } as OpenBotEvent;
        } catch (error) {
          yield {
            type: 'action:plugin:install:result',
            data: { success: false, error: (error as Error).message },
          } as OpenBotEvent;
        }
      });

      builder.on('action:plugin:uninstall', async function* (event) {
        try {
          await pluginService.uninstall(event.data.id);
          yield { type: 'action:plugin:uninstall:result', data: { success: true } };
        } catch (error) {
          yield {
            type: 'action:plugin:uninstall:result',
            data: { success: false, error: (error as Error).message },
          };
        }
      });

      builder.on('action:marketplace:list', async function* () {
        const { marketplaceRegistryUrl } = loadConfig();
        const registryUrl =
          marketplaceRegistryUrl?.trim() || DEFAULT_MARKETPLACE_REGISTRY_URL;
        let agents = DEFAULT_MARKETPLACE_AGENTS;
        try {
          agents = await fetchMarketplaceAgentsFromUrl(registryUrl);
        } catch (err) {
          console.warn(
            `[bus] marketplace registry fetch failed (${registryUrl}), using built-in list:`,
            err instanceof Error ? err.message : err,
          );
        }
        yield {
          type: 'action:marketplace:list:result',
          data: { success: true, agents },
        } as OpenBotEvent;
      });

      builder.on('action:remember', async function* (event, context) {
        const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };
        try {
          const { content, scope, tags } = event.data;
          const record = await storage.appendMemory({
            scope: resolveMemoryScope(scope, context.state),
            content,
            tags,
          });
          yield {
            type: 'action:remember:result',
            data: { success: true, record },
            meta: resultMeta,
          } as OpenBotEvent;
        } catch (error) {
          yield {
            type: 'action:remember:result',
            data: {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
            meta: resultMeta,
          } as OpenBotEvent;
        }
      });

      builder.on('action:recall', async function* (event, context) {
        const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };
        try {
          const { query, tag, scope, limit } = event.data;
          const records = await storage.listMemories({
            scopes: resolveMemoryScopeFilter(scope, context.state),
            query,
            tag,
            limit,
          });
          yield {
            type: 'action:recall:result',
            data: { success: true, records },
            meta: resultMeta,
          } as OpenBotEvent;
        } catch (error) {
          yield {
            type: 'action:recall:result',
            data: {
              success: false,
              records: [],
              error: error instanceof Error ? error.message : 'Unknown error',
            },
            meta: resultMeta,
          } as OpenBotEvent;
        }
      });

      builder.on('action:forget', async function* (event, context) {
        const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };
        try {
          const deleted = await storage.deleteMemory({ id: event.data.id });
          yield {
            type: 'action:forget:result',
            data: { success: true, deleted },
            meta: resultMeta,
          } as OpenBotEvent;
        } catch (error) {
          yield {
            type: 'action:forget:result',
            data: {
              success: false,
              deleted: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
            meta: resultMeta,
          } as OpenBotEvent;
        }
      });

      builder.on('action:agent:install', async function* (event) {
        try {
          const { agentId, name, description, instructions, plugins } = event.data;

          // Ensure each plugin is available locally. Built-in ids resolve
          // immediately; npm-name ids are fetched on demand.
          for (const ref of plugins) {
            const installed = await pluginService.isInstalled(ref.id);
            if (!installed && ref.id.includes('/') === false && ref.id.includes('-plugin-') === false) {
              // Treat ids without a hyphen+slash signature as built-ins; skip install.
              continue;
            }
            if (!installed) {
              try {
                await pluginService.install({ packageName: ref.id });
              } catch (err) {
                console.warn(`[bus] Failed to pre-install plugin ${ref.id}`, err);
              }
            }
          }

          await storage.createAgent({
            agentId,
            name,
            description,
            instructions,
            plugins,
          });
          yield {
            type: 'action:agent:install:result',
            data: { success: true, agentId },
          } as OpenBotEvent;
          yield {
            type: 'agent:output',
            data: { content: `Successfully installed agent **${name}** (${agentId}) from marketplace.` },
            meta: { agentId: 'system' },
          } as OpenBotEvent;
        } catch (error) {
          yield {
            type: 'action:agent:install:result',
            data: {
              success: false,
              agentId: event.data.agentId,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          } as OpenBotEvent;
        }
      });
    };
