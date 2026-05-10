import { OpenBotEvent, OpenBotState } from '../app/types.js';
import { Storage } from '../bus/types.js';

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

  engine.registerProvider(new AgentDetailsProvider());
  engine.registerProvider(new ChannelDetailsProvider());
  engine.registerProvider(new ThreadDetailsProvider());
  engine.registerProvider(new MemoryProvider());
  engine.registerProvider(new RecentEventsProvider());

  engine.registerProcessor(new TokenBudgetProcessor());

  return engine;
}

class AgentDetailsProvider implements ContextProvider {
  name = 'agent-details';
  async provide(state: OpenBotState): Promise<ContextItem[]> {
    if (!state.agentDetails) return [];
    return [{
      id: 'agent-details',
      type: 'agent',
      priority: 100,
      content: `## AGENT NAME\n${state.agentDetails.name}\n\n## AGENT SPECIFICATION\n${state.agentDetails.instructions}`
    }];
  }
}

class ChannelDetailsProvider implements ContextProvider {
  name = 'channel-details';
  async provide(state: OpenBotState): Promise<ContextItem[]> {
    if (!state.channelDetails) return [];
    return [{
      id: 'channel-details',
      type: 'channel',
      priority: 80,
      content: `## CHANNEL NAME\n${state.channelDetails.name}\n\n## CHANNEL SPECIFICATION\n${state.channelDetails.spec}`
    }];
  }
}

class ThreadDetailsProvider implements ContextProvider {
  name = 'thread-details';
  async provide(state: OpenBotState): Promise<ContextItem[]> {
    if (!state.threadDetails) return [];
    return [{
      id: 'thread-details',
      type: 'thread',
      priority: 90,
      content: `## THREAD NAME\n${state.threadDetails.name}\n\n## THREAD SPECIFICATION\n${state.threadDetails.spec}`
    }];
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
          content: `## REMEMBERED FACTS\nThese are durable facts you previously stored with the \`remember\` tool. Trust them unless contradicted by the user. Use \`forget\` to remove ones that are stale.\n\n${formatted}`,
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
 * token budget. The first item with priority >= `keepFloor` is always kept,
 * so the agent's own instructions can never be evicted. Stable on ties:
 * later-emitted items go first.
 */
export class TokenBudgetProcessor implements ContextProcessor {
  name = 'token-budget';
  /** Soft prompt budget in tokens (matches gpt-4o-mini's reasonable system slice). */
  static DEFAULT_BUDGET = 8000;
  /** Items at or above this priority are never dropped. */
  static KEEP_FLOOR = 100;

  constructor(
    private budget: number = TokenBudgetProcessor.DEFAULT_BUDGET,
    private keepFloor: number = TokenBudgetProcessor.KEEP_FLOOR,
  ) {}

  async process(items: ContextItem[]): Promise<ContextItem[]> {
    const sorted = [...items].sort((a, b) => b.priority - a.priority);
    const out: ContextItem[] = [];
    let used = 0;

    for (const item of sorted) {
      const cost = estimateTokens(item.content);
      if (item.priority >= this.keepFloor) {
        out.push(item);
        used += cost;
        continue;
      }
      if (used + cost <= this.budget) {
        out.push(item);
        used += cost;
      }
    }

    return out;
  }
}
