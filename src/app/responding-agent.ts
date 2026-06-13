import { ORCHESTRATOR_AGENT_ID } from './agent-ids.js';
import { storageService } from '../plugins/storage/service.js';

/** Thread `state.json` key for the sticky responding agent id. */
export const THREAD_RESPONDING_AGENT_ID_KEY = 'respondingAgentId';

export type ResolveRespondingAgentOptions = {
  channelId: string;
  threadId?: string;
  requestedAgentId?: string;
  /** When true, persist `respondingAgentId` on the first unbound thread touch. */
  bindIfUnbound?: boolean;
};

export type ResolveRespondingAgentResult = {
  agentId: string;
  /** True when the thread already had or now has a persisted responding agent. */
  bound: boolean;
  /** True when the request asked for a different agent than the bound one. */
  overridden: boolean;
};

const readBoundAgentId = (state: unknown): string | undefined => {
  if (!state || typeof state !== 'object') return undefined;
  const value = (state as Record<string, unknown>)[THREAD_RESPONDING_AGENT_ID_KEY];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

/**
 * Resolves which agent should handle a thread-scoped publish.
 * Once `respondingAgentId` is stored on the thread, that value wins over request overrides.
 */
export async function resolveRespondingAgentId(
  options: ResolveRespondingAgentOptions,
): Promise<ResolveRespondingAgentResult> {
  const { channelId, threadId, requestedAgentId, bindIfUnbound = false } = options;
  const requested = requestedAgentId?.trim() || undefined;
  const fallback = requested || ORCHESTRATOR_AGENT_ID;

  if (!threadId) {
    return { agentId: fallback, bound: false, overridden: false };
  }

  const details = await storageService.getThreadDetails({ channelId, threadId });
  const bound = readBoundAgentId(details.state);

  if (bound) {
    const overridden = !!requested && requested !== bound;
    if (overridden) {
      console.warn('[publish] Ignoring agentId override; thread is bound to responding agent', {
        threadId,
        bound,
        requested,
      });
    }
    return { agentId: bound, bound: true, overridden };
  }

  if (!bindIfUnbound) {
    return { agentId: fallback, bound: false, overridden: false };
  }

  await storageService.getAgentDetails({ agentId: fallback });

  await storageService.patchThreadState({
    channelId,
    threadId,
    state: { [THREAD_RESPONDING_AGENT_ID_KEY]: fallback },
  });

  return { agentId: fallback, bound: true, overridden: false };
}
