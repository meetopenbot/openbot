import { OpenBotState } from '../../app/types.js';
import { Storage } from '../../services/plugins/domain.js';

export const DEFAULT_CONTEXT_BUDGET = 8000;

/**
 * Returns the known context window budget (in tokens) for a given model string.
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

/** Built-in orchestrator agent id. */
export const ORCHESTRATOR_AGENT_ID = 'system';

/**
 * Check if a channel is a solo DM (only the agent is present).
 */
export function isDmSoloChannel(participants: string[], agentId: string): boolean {
  return participants.length === 0 || (participants.length === 1 && participants[0] === agentId);
}

/**
 * Simplified context builder for MVP.
 */
export async function buildContext(state: OpenBotState, storage?: Storage): Promise<string> {
  const { channelId, threadId, channelDetails, agentId, threadDetails, agentDetails } = state;
  const participants = channelDetails?.participants || [];
  const isDm = isDmSoloChannel(participants, agentId);

  const sections: string[] = [];

  // 1. Environment
  let env = '## ENVIRONMENT\n';
  if (isDm) {
    env += '- Mode: Direct Message (Solo)\n';
  } else {
    const channelName = channelDetails?.name || channelId;
    env += `- Mode: Channel (#${channelName})\n`;
    if (threadId) {
      env += `- Thread: ${threadDetails?.name || threadId}\n`;
    }
    const peerIds = participants.filter((id: string) => id !== agentId);
    if (peerIds.length > 0) {
      env += `- Participants: ${peerIds.join(', ')}\n`;
    }
  }
  sections.push(env);

  // 2. Channel Spec
  const spec = channelDetails?.spec?.trim();
  if (spec) {
    sections.push(`## CHANNEL SPECIFICATION\n${spec}`);
  }

  // 3. Agent Instructions
  if (agentDetails?.instructions) {
    sections.push(`## AGENT: ${agentDetails?.name}\n${agentDetails.instructions}`);
  }

  // 4. Memories
  if (storage?.listMemories) {
    try {
      const scopes = ['global', `agent:${agentId}`];
      if (channelId) scopes.push(`channel:${channelId}`);
      const records = await storage.listMemories({ scopes, limit: 20 });
      if (records.length > 0) {
        const formatted = records
          .map((r: any) => `- (${r.scope}) ${r.content}`)
          .join('\n');
        sections.push(`## MEMORIES\n${formatted}`);
      }
    } catch (error) {
      console.warn('[context] Failed to fetch memories:', error);
    }
  }

  return sections.join('\n\n');
}
