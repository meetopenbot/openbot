import { OpenBotEvent, OpenBotState, TodoItem } from '../app/types.js';
import { Storage } from '../bus/types.js';
import { isDmSoloChannel } from './channel-participants.js';

export const DEFAULT_CONTEXT_BUDGET = 8000;

/**
 * Returns the known context window budget (in tokens) for a given model string.
 * This is used to drive the context usage ring in the UI and to configure
 * the prompt pruning budget.
 */
export const getContextBudgetForModel = (modelString: string): number => {
  const budgets: Record<string, number> = {
    'openai/gpt-4o': 128000,
    'openai/gpt-4o-mini': 128000,
    'openai/o1-preview': 128000,
    'openai/o1-mini': 128000,
    'anthropic/claude-3-5-sonnet-20240620': 200000,
    'anthropic/claude-3-5-sonnet-latest': 200000,
    'anthropic/claude-3-opus-20240229': 200000,
    'anthropic/claude-3-sonnet-20240229': 200000,
    'anthropic/claude-3-haiku-20240307': 200000,
  };

  return budgets[modelString] || DEFAULT_CONTEXT_BUDGET;
};

/** Built-in orchestrator agent id (`~/.openbot/agents/system/AGENT.md` overrides instructions). */
export const ORCHESTRATOR_AGENT_ID = 'system';

/**
 * Represents a piece of context that can be used in a prompt.
 *
 * Items flow through the engine in two phases:
 *   1. Each registered `ContextProvider` emits zero or more items.
 *   2. Each registered `ContextProcessor` may transform / drop / re-rank
 *      items (e.g. token-budget enforcement).
 *
 * Higher `priority` items appear first in the assembled prompt and are the
 * last to be dropped under budget pressure.
 */
export interface ContextItem {
  id: string;
  type: string;
  priority: number;
  content: string;
  metadata?: Record<string, any>;
}

export interface ContextProvider {
  name: string;
  provide(state: OpenBotState, storage?: Storage): Promise<ContextItem[]>;
}

export interface ContextProcessor {
  name: string;
  process(items: ContextItem[], state: OpenBotState): Promise<ContextItem[]>;
}

/**
 * Cheap, dependency-free token estimator. Roughly char/4 — fine for budget
 * enforcement; can be swapped for a tokenizer-backed implementation later
 * without touching providers.
 */
export const estimateTokens = (text: string): number =>
  Math.ceil((text?.length ?? 0) / 4);

/**
 * Hard cap (in characters) on a single context item. Keeps any one provider
 * — typically the recent-events feed — from monopolising the prompt budget.
 */
const ITEM_HARD_CHAR_CAP = 6000;

const truncate = (text: string, maxChars: number): string =>
  text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n…[truncated]`;

export class ContextEngine {
  private providers: ContextProvider[] = [];
  private processors: ContextProcessor[] = [];

  registerProvider(provider: ContextProvider) {
    this.providers.push(provider);
  }

  registerProcessor(processor: ContextProcessor) {
    this.processors.push(processor);
  }

  async buildContext(state: OpenBotState, storage?: Storage): Promise<string> {
    let items: ContextItem[] = [];
    for (const provider of this.providers) {
      try {
        const providedItems = await provider.provide(state, storage);
        for (const item of providedItems) {
          items.push({ ...item, content: truncate(item.content, ITEM_HARD_CHAR_CAP) });
        }
      } catch (error) {
        console.warn(`[ContextEngine] Provider ${provider.name} failed:`, error);
      }
    }

    for (const processor of this.processors) {
      try {
        items = await processor.process(items, state);
      } catch (error) {
        console.warn(`[ContextEngine] Processor ${processor.name} failed:`, error);
      }
    }

    return items
      .sort((a, b) => b.priority - a.priority)
      .map((item) => item.content)
      .join('\n\n');
  }
}

/**
 * Default context engine. Order of providers is by emit order; final ordering
 * in the prompt is determined by `priority`. The token-budget processor runs
 * last so dropping happens after every provider has contributed.
 */
export function createDefaultContextEngine(): ContextEngine {
  const engine = new ContextEngine();

  engine.registerProvider(new EnvironmentProvider());
  engine.registerProvider(new ChannelSpecProvider());
  engine.registerProvider(new AgentDetailsProvider());
  engine.registerProvider(new TodoProvider());
  engine.registerProvider(new MemoryProvider());
  // engine.registerProvider(new RecentEventsProvider());

  engine.registerProcessor(new TokenBudgetProcessor());

  return engine;
}

class EnvironmentProvider implements ContextProvider {
  name = 'environment';
  async provide(state: OpenBotState): Promise<ContextItem[]> {
    const { channelId, threadId, channelDetails, agentId, threadDetails } = state;
    const participants = channelDetails?.participants || [];
    const isDm = isDmSoloChannel(participants, agentId);

    let content = '## ENVIRONMENT\n';
    if (isDm) {
      content += '- Mode: Direct Message (Solo)\n';
      content += '- Context: You are in a private conversation. No other agents are present.\n';
    } else {
      const channelName = channelDetails?.name || channelId;
      content += `- Mode: Channel (#${channelName})\n`;
      if (threadId) {
        content += `- Thread: ${threadDetails?.name || threadId}\n`;
      }

      const peerIds = participants.filter((id) => id !== agentId);
      if (peerIds.length > 0) {
        content += `- Participants: ${peerIds.join(', ')}\n`;
        content += `  (Use these plain ids for todo assignees and delegate_to_agent — no @ prefix.)\n`;
      }
    }

    return [
      {
        id: 'environment',
        type: 'environment',
        priority: 110,
        content,
      },
    ];
  }
}

/**
 * Injects SPEC.md (`channelDetails.spec`). Kept distinct from EnvironmentProvider
 * so each block gets its own truncate budget and channel rules survive long
 * participant lists under {@link ITEM_HARD_CHAR_CAP}.
 */
class ChannelSpecProvider implements ContextProvider {
  name = 'channel-spec';

  async provide(state: OpenBotState): Promise<ContextItem[]> {
    const raw = state.channelDetails?.spec;
    const spec = typeof raw === 'string' ? raw.trim() : '';
    if (!spec) return [];

    return [
      {
        id: 'channel-spec',
        type: 'channel-spec',
        /** Below environment (110), above agent / {@link TokenBudgetProcessor.KEEP_FLOOR}. */
        priority: 108,
        content:
          `## CHANNEL SPECIFICATION (SPEC.md)\n` +
          `Channel-level goals and constraints. Prefer these unless the user contradicts them.\n\n` +
          `${spec}`,
      },
    ];
  }
}

class AgentDetailsProvider implements ContextProvider {
  name = 'agent-details';
  async provide(state: OpenBotState): Promise<ContextItem[]> {
    if (!state.agentDetails) return [];
    if (state.agentId === ORCHESTRATOR_AGENT_ID) return [];
    const instructions = state.agentDetails.instructions?.trim();
    if (!instructions) return [];

    return [
      {
        id: 'agent-details',
        type: 'agent',
        priority: 100,
        content: `## AGENT: ${state.agentDetails.name}\n\n${instructions}`,
      },
    ];
  }
}

/**
 * Surfaces the shared per-thread todo list. The list lives in
 * `threadDetails.state.todos` and is owned by bus services — every agent in
 * the thread reads from the same canonical source, which is how multi-agent
 * autonomous flows stay coordinated.
 */
class TodoProvider implements ContextProvider {
  name = 'todos';
  async provide(state: OpenBotState): Promise<ContextItem[]> {
    if (state.agentId !== ORCHESTRATOR_AGENT_ID) return [];

    const raw = (state.threadDetails?.state as Record<string, unknown> | undefined)?.todos;
    const todos: TodoItem[] = Array.isArray(raw) ? (raw as TodoItem[]) : [];
    if (todos.length === 0) return [];

    const DISPLAY_RESULT_CAP = 2500;

    const marker: Record<TodoItem['status'], string> = {
      pending: '[ ]',
      in_progress: '[~]',
      done: '[x]',
      cancelled: '[-]',
    };
    const formatted = todos
      .map((t) => {
        const assignee = t.assignee ? ` @${t.assignee}` : '';
        let line = `- ${marker[t.status]} (${t.id})${assignee} ${t.content}`;
        if (t.status === 'done' && t.result?.trim()) {
          let snippet = t.result.trim();
          if (snippet.length > DISPLAY_RESULT_CAP) {
            snippet = `${snippet.slice(0, DISPLAY_RESULT_CAP)}…[truncated]`;
          }
          line += `\n  Result: ${snippet}`;
        }
        return line;
      })
      .join('\n');

    return [
      {
        id: 'todos',
        type: 'todos',
        priority: 92,
        content:
          `## SHARED TODO PLAN (thread state)\n` +
          `${formatted}`,
      },
    ];
  }
}

/**
 * Fetches relevant memories (global + active agent + active channel) and
 * surfaces them at high priority so the LLM treats them as ground truth
 * rather than chat history.
 */
class MemoryProvider implements ContextProvider {
  name = 'memory';
  async provide(state: OpenBotState, storage?: Storage): Promise<ContextItem[]> {
    if (!storage?.listMemories) return [];

    try {
      const scopes = ['global', `agent:${state.agentId}`];
      if (state.channelId) scopes.push(`channel:${state.channelId}`);

      const records = await storage.listMemories({ scopes, limit: 50 });
      if (records.length === 0) return [];

      const formatted = records
        .map((r) => {
          const tags = r.tags?.length ? ` [${r.tags.join(', ')}]` : '';
          const scopeLabel = r.scope === 'global' ? 'global' : r.scope;
          return `- (${scopeLabel}${tags}) ${r.content}`;
        })
        .join('\n');

      return [
        {
          id: 'memory',
          type: 'memory',
          priority: 95,
          content: `## Remembered global facts\nTrust these unless the user contradicts them. Use \`forget\` to remove stale ones.\n\n${formatted}`,
        },
      ];
    } catch (error) {
      console.warn('[ContextEngine] MemoryProvider failed:', error);
      return [];
    }
  }
}

/**
 * Event types we omit from the recent-events context block. They duplicate
 * information already in the conversation history, are infrastructural
 * noise, or are too large to be useful as a tail summary.
 */
const NOISY_EVENT_PREFIXES = [
  'agent:invoke',
  'agent:output',
  'agent:run',
  'agent:active-runs',
  'client:ui',
  'stream:',
  'action:storage:get-',
  'action:storage:patch-',
];

const MAX_RECENT_EVENTS = 20;
const MAX_EVENT_DATA_CHARS = 300;

const isNoisyEvent = (event: OpenBotEvent): boolean =>
  NOISY_EVENT_PREFIXES.some((prefix) => event.type.startsWith(prefix));

const summarizeEvent = (event: OpenBotEvent): string => {
  const data = (event as { data?: unknown }).data;
  if (data === undefined) return `- ${event.type}`;
  let payload: string;
  try {
    payload = typeof data === 'string' ? data : JSON.stringify(data);
  } catch {
    payload = '[unserialisable]';
  }
  if (payload.length > MAX_EVENT_DATA_CHARS) {
    payload = `${payload.slice(0, MAX_EVENT_DATA_CHARS)}…`;
  }
  return `- ${event.type}: ${payload}`;
};

class RecentEventsProvider implements ContextProvider {
  name = 'recent-events';
  async provide(state: OpenBotState, storage?: Storage): Promise<ContextItem[]> {
    if (!storage) return [];

    const channelId = state.channelId;
    const threadId = state.threadId;

    try {
      const events = await storage.getEvents({ channelId, threadId });
      const filtered = events.filter((e) => !isNoisyEvent(e));
      if (filtered.length === 0) return [];

      const formatted = filtered.slice(-MAX_RECENT_EVENTS).map(summarizeEvent).join('\n');

      return [
        {
          id: threadId ? 'thread-events' : 'channel-events',
          type: 'events',
          priority: 70,
          content: `## ${threadId ? 'THREAD' : 'CHANNEL'} RECENT ACTIVITIES (events)\n${formatted}`,
        },
      ];
    } catch (error) {
      console.warn('[ContextEngine] Failed to fetch events:', error);
      return [];
    }
  }
}

/**
 * Drops the lowest-priority items until the assembled prompt fits within the
 * token budget. The first item with priority >= \`keepFloor\` is always kept,
 * so the agent's own instructions can never be evicted. Stable on ties:
 * later-emitted items go first.
 */
export class TokenBudgetProcessor implements ContextProcessor {
  name = 'token-budget';
  /** Soft prompt budget in tokens (matches gpt-4o-mini's reasonable system slice). */
  static DEFAULT_BUDGET = DEFAULT_CONTEXT_BUDGET;
  /** Items at or above this priority are never dropped. */
  static KEEP_FLOOR = 100;

  constructor(
    private budget: number | undefined = undefined,
    private keepFloor: number = TokenBudgetProcessor.KEEP_FLOOR,
  ) {}

  async process(items: ContextItem[], state: OpenBotState): Promise<ContextItem[]> {
    const sorted = [...items].sort((a, b) => b.priority - a.priority);
    const out: ContextItem[] = [];
    let used = 0;

    const activeBudget =
      this.budget ?? (state.model ? getContextBudgetForModel(state.model) : TokenBudgetProcessor.DEFAULT_BUDGET);

    for (const item of sorted) {
      const cost = estimateTokens(item.content);
      if (item.priority >= this.keepFloor) {
        out.push(item);
        used += cost;
        continue;
      }
      if (used + cost <= activeBudget) {
        out.push(item);
        used += cost;
      }
    }

    return out;
  }
}
