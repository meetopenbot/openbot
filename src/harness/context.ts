import { OpenBotState } from '../app/types.js';
import { Storage } from '../plugins/storage.js';

/**
 * Represents a piece of context that can be used in a prompt.
 */
export interface ContextItem {
  id: string;
  type: string;
  priority: number;
  content: string;
  metadata?: Record<string, any>;
}

/**
 * A provider that can fetch or generate context items.
 */
export interface ContextProvider {
  name: string;
  provide(state: OpenBotState, storage?: Storage): Promise<ContextItem[]>;
}

/**
 * A processor that can transform or filter context items (e.g., ranking, truncation).
 */
export interface ContextProcessor {
  name: string;
  process(items: ContextItem[], state: OpenBotState): Promise<ContextItem[]>;
}

/**
 * The core engine that orchestrates context building.
 */
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
    // 1. Collect context from all providers
    let items: ContextItem[] = [];
    for (const provider of this.providers) {
      try {
        const providedItems = await provider.provide(state, storage);
        items.push(...providedItems);
      } catch (error) {
        console.warn(`[ContextEngine] Provider ${provider.name} failed:`, error);
      }
    }

    // 2. Run through processors
    for (const processor of this.processors) {
      try {
        items = await processor.process(items, state);
      } catch (error) {
        console.warn(`[ContextEngine] Processor ${processor.name} failed:`, error);
      }
    }

    // 3. Format items into a single string
    return items
      .sort((a, b) => b.priority - a.priority)
      .map(item => item.content)
      .join('\n\n');
  }
}

/**
 * Default implementation of a Context Engine with basic providers.
 */
export function createDefaultContextEngine(): ContextEngine {
  const engine = new ContextEngine();

  // Basic Providers
  engine.registerProvider(new AgentDetailsProvider());
  engine.registerProvider(new ChannelDetailsProvider());
  engine.registerProvider(new ThreadDetailsProvider());
  engine.registerProvider(new RecentEventsProvider());

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

class RecentEventsProvider implements ContextProvider {
  name = 'recent-events';
  async provide(state: OpenBotState, storage?: Storage): Promise<ContextItem[]> {
    if (!storage) return [];
    const items: ContextItem[] = [];

    // Fetch channel events if no thread, otherwise fetch thread events
    const channelId = state.channelId;
    const threadId = state.threadId;

    try {
      const events = await storage.getEvents({ channelId, threadId });
      if (events.length > 0) {
        const formattedEvents = events
          .slice(-20)
          .map((e) => `- ${e.type}: ${JSON.stringify((e as any).data || {})}`)
          .join('\n');
        
        items.push({
          id: threadId ? 'thread-events' : 'channel-events',
          type: 'events',
          priority: 70,
          content: `## ${threadId ? 'THREAD' : 'CHANNEL'} RECENT ACTIVITIES (events)\n${formattedEvents}`
        });
      }
    } catch (error) {
      console.warn(`[ContextEngine] Failed to fetch events:`, error);
    }

    return items;
  }
}
