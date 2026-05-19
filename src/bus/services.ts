import { MelonyPlugin } from 'melony';
import { DEFAULT_MARKETPLACE_REGISTRY_URL, loadConfig } from '../app/config.js';
import {
  OpenBotEvent,
  OpenBotState,
  MemoryScopeAlias,
  TodoItem,
  TodoStatus,
  TodoWriteInput,
} from '../app/types.js';
import type { PluginRef } from './plugin.js';
import { Storage } from './types.js';
import { storageService } from '../services/storage.js';
import { pluginService } from '../services/plugins.js';
import { isParticipantDispatchAllowed } from '../harness/channel-participants.js';
import { ORCHESTRATOR_AGENT_ID } from '../harness/context.js';
import { makeInternalInvoke, runAgentTurn } from '../harness/agent-turn.js';

const readTodos = (state: OpenBotState): TodoItem[] => {
  const raw = (state.threadDetails?.state as Record<string, unknown> | undefined)?.todos;
  return Array.isArray(raw) ? (raw as TodoItem[]) : [];
};

let todoCounter = 0;
const newTodoId = (now: number, idx: number): string =>
  `todo_${now.toString(36)}_${(todoCounter++).toString(36)}_${idx}`;

const normalizeAgentId = (id: string): string => id.trim().replace(/^@+/, '');

const normalizeAssignee = (assignee: string | undefined): string | undefined => {
  if (assignee === undefined || assignee === '') return undefined;
  return normalizeAgentId(assignee);
};

async function persistTodos(
  storage: Storage,
  state: OpenBotState,
  todos: TodoItem[],
): Promise<void> {
  if (!state.threadId) throw new Error('No active thread');
  await storage.patchThreadState({
    channelId: state.channelId,
    threadId: state.threadId,
    state: { todos },
  });
  state.threadDetails = await storage.getThreadDetails({
    channelId: state.channelId,
    threadId: state.threadId,
  });
}


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

const DEFAULT_MARKETPLACE_AGENTS: MarketplaceAgentListing[] = [];

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
        const { channelId, spec, initialState, cwd, participants } = (event as any).data;
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

        const mergedInitial: Record<string, unknown> = { ...(initialState || {}) };
        if (participants !== undefined) {
          const normalized = Array.isArray(participants)
            ? participants
              .filter((x: unknown): x is string => typeof x === 'string')
              .map((s: string) => s.trim())
              .filter(Boolean)
            : [];
          mergedInitial.participants = normalized;
        }

        try {
          await storage.createChannel({
            channelId: rawChannelId,
            spec: channelSpec,
            initialState: mergedInitial,
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
        const data = (event.data || {}) as {
          channelId?: string;
          name?: string;
          cwd?: string;
          participants?: string[];
        };
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
        if (data.participants !== undefined) {
          if (Array.isArray(data.participants)) {
            patch.participants = data.participants
              .filter((x): x is string => typeof x === 'string')
              .map((s) => s.trim())
              .filter(Boolean);
          } else {
            patch.participants = [];
          }
          updatedFields.push('participants');
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
        const updatedFields: ('state' | 'spec' | 'cwd' | 'participants')[] = [];
        const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };
        const data = (event.data || {}) as {
          state?: Record<string, unknown>;
          spec?: string;
          cwd?: string;
          participants?: string[];
        };
        try {
          if (data.state !== undefined) {
            await storage.patchChannelState({
              channelId: context.state.channelId,
              state: data.state,
            });
            updatedFields.push('state');
          }
          if (typeof data.spec === 'string') {
            await storage.patchChannelSpec({
              channelId: context.state.channelId,
              spec: data.spec,
            });
            updatedFields.push('spec');
          }
          if (typeof data.cwd === 'string') {
            await storage.patchChannelState({
              channelId: context.state.channelId,
              state: { cwd: data.cwd },
            });
            updatedFields.push('cwd');
          }
          if (data.participants !== undefined) {
            const normalized = Array.isArray(data.participants)
              ? data.participants
                .filter((x): x is string => typeof x === 'string')
                .map((s) => s.trim())
                .filter(Boolean)
              : [];
            await storage.patchChannelState({
              channelId: context.state.channelId,
              state: { participants: normalized },
            });
            updatedFields.push('participants');
          }

          context.state.channelDetails = await storage.getChannelDetails({
            channelId: context.state.channelId,
          });

          yield {
            type: "client:ui:widget",
            data: {
              kind: "message",
              title: "Channel details updated.",
              body: "The channel details have been updated.",
            },
            meta: resultMeta,
          }

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

      builder.on('action:todo_write', async function* (event, context) {
        const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };
        try {
          if (!context.state.threadId) {
            throw new Error('todo_write requires an active thread');
          }
          const existing = readTodos(context.state);
          const byId = new Map(existing.map((t) => [t.id, t]));
          const now = Date.now();
          const author = context.state.agentId || 'system';

          const { todos: inputs, merge = true } = event.data as {
            todos: TodoWriteInput[];
            merge?: boolean;
          };

          let next: TodoItem[];

          if (merge) {
            // Patch existing and append new
            const updatedIds = new Set<string>();
            const deletions = new Set<string>();

            const patched = existing.map((t) => {
              const patch = inputs.find((i) => i.id === t.id);
              if (!patch) return t;
              if (patch.deleted) {
                deletions.add(t.id);
                return t;
              }
              updatedIds.add(t.id);
              return {
                ...t,
                ...(patch.content !== undefined ? { content: patch.content } : {}),
                ...(patch.status !== undefined ? { status: patch.status } : {}),
                ...(patch.assignee !== undefined
                  ? { assignee: normalizeAssignee(patch.assignee === '' ? undefined : patch.assignee) }
                  : {}),
                updatedAt: now,
              };
            });

            const additions = inputs
              .filter((i) => !i.id || (!byId.has(i.id) && !i.deleted))
              .map((raw, idx) => ({
                id: raw.id || newTodoId(now, idx),
                content: raw.content || '',
                status: raw.status || 'pending',
                assignee: normalizeAssignee(raw.assignee),
                createdBy: author,
                createdAt: now,
                updatedAt: now,
              }));

            next = [...patched, ...additions].filter((t) => !deletions.has(t.id));
          } else {
            // Replace all
            next = inputs
              .filter((i) => !i.deleted)
              .map((raw, idx) => {
                const prior = raw.id ? byId.get(raw.id) : undefined;
                return {
                  id: prior?.id || raw.id || newTodoId(now, idx),
                  content: raw.content || prior?.content || '',
                  status: raw.status || prior?.status || 'pending',
                  assignee: normalizeAssignee(raw.assignee ?? prior?.assignee),
                  createdBy: prior?.createdBy || author,
                  createdAt: prior?.createdAt || now,
                  updatedAt: now,
                  ...(prior?.result !== undefined ? { result: prior.result } : {}),
                };
              });
          }

          await persistTodos(storage, context.state, next);

          yield {
            type: 'action:todo_write:result',
            data: { success: true, todos: next },
            meta: resultMeta,
          } as OpenBotEvent;
        } catch (error) {
          yield {
            type: 'action:todo_write:result',
            data: {
              success: false,
              todos: readTodos(context.state),
              error: error instanceof Error ? error.message : 'Unknown error',
            },
            meta: resultMeta,
          } as OpenBotEvent;
        }
      });

      builder.on('action:delegate_to_agent', async function* (event, context) {
        const resultMeta = { ...(event.meta || {}), agentId: context.state.agentId };
        try {
          if (context.state.agentId !== ORCHESTRATOR_AGENT_ID) {
            throw new Error('delegate_to_agent is only available to the orchestrator agent');
          }
          if (!context.state.threadId) {
            throw new Error('delegate_to_agent requires an active thread');
          }

          const rawAgentId = (event.data as { agentId: string }).agentId;
          const agentId = normalizeAgentId(rawAgentId);
          const { task, todoId } = event.data as {
            agentId: string;
            task: string;
            todoId?: string;
          };

          if (!agentId) throw new Error('agentId is required');
          if (!task?.trim()) throw new Error('task is required');

          await storage.getAgentDetails({ agentId });

          const participants = context.state.channelDetails?.participants ?? [];
          if (
            !isParticipantDispatchAllowed(participants, context.state.agentId, agentId)
          ) {
            throw new Error(
              `Agent "${agentId}" is not allowed in this channel. Check channel participants.`,
            );
          }

          const trimmedTask = task.trim();
          const linkedTodoId = todoId?.trim() || undefined;
          const workerInvoke = makeInternalInvoke(trimmedTask, context.state.threadId);

          let workerOutput: string | undefined;
          const turn = runAgentTurn({
            runId: context.state.runId,
            channelId: context.state.channelId,
            threadId: context.state.threadId,
            agentId,
            event: workerInvoke,
            delegationTodoId: linkedTodoId,
          });
          let next = await turn.next();
          while (!next.done) {
            yield next.value;
            next = await turn.next();
          }
          workerOutput = next.value;

          context.state.threadDetails = await storage.getThreadDetails({
            channelId: context.state.channelId,
            threadId: context.state.threadId,
          });

          yield {
            type: 'action:delegate_to_agent:result',
            data: {
              success: true,
              agentId,
              output: workerOutput?.trim() || '(no text output)',
            },
            meta: resultMeta,
          } as OpenBotEvent;
        } catch (error) {
          yield {
            type: 'action:delegate_to_agent:result',
            data: {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
            meta: resultMeta,
          } as OpenBotEvent;
        }
      });

      builder.on('agent:usage', async function* (event, context) {
        const { usage } = event.data;
        if (!context.state.threadId) return;

        const currentState = (context.state.threadDetails?.state as Record<string, any>) || {};
        const currentUsage = currentState.usage || {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        };

        const nextUsage = {
          promptTokens: (currentUsage.promptTokens || 0) + usage.promptTokens,
          completionTokens: (currentUsage.completionTokens || 0) + usage.completionTokens,
          totalTokens: (currentUsage.totalTokens || 0) + usage.totalTokens,
        };

        await storage.patchThreadState({
          channelId: context.state.channelId,
          threadId: context.state.threadId,
          state: { usage: nextUsage },
        });

        context.state.threadDetails = await storage.getThreadDetails({
          channelId: context.state.channelId,
          threadId: context.state.threadId,
        });
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
          const { agentId, name, description, image, instructions, plugins } = event.data;
          await storage.createAgent({ agentId, name, description, image, instructions, plugins });
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
          const { agentId, name, description, image, instructions, plugins } = event.data;
          await storage.updateAgent({ agentId, name, description, image, instructions, plugins });
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
          const { agentId, name, description, image, instructions, plugins } = event.data;

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
            image,
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
