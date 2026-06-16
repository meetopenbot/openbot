import { OpenBotState } from '../../app/types.js';
import { Storage } from '../../services/plugins/domain.js';
import { OPENBOT_SYSTEM_PROMPT } from './system-prompt.js';

export const DEFAULT_CONTEXT_BUDGET = 8000;
export const MAX_CONTEXT_FILES = 50;

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
 * Simplified context builder for MVP.
 */
export async function buildContext(state: OpenBotState, storage?: Storage): Promise<string> {
  const { channelId, threadId, channelDetails, agentId, threadDetails, agentDetails } = state;

  const sections: string[] = [];

  // Fetch agents once if storage is available
  const allAgents = storage?.getAgents ? await storage.getAgents().catch(() => []) : [];

  // 1. User
  if (state.currentUser?.userName) {
    sections.push(`## HUMAN\n- Name: ${state.currentUser.userName}`);
  }

  // 2. Environment
  let env = '## ENVIRONMENT\n';
  const channelName = channelDetails?.name || channelId;
  env += `- Mode: Channel (#${channelName})\n`;
  if (channelDetails?.cwd) {
    env += `- Workspace: ${channelDetails.cwd}\n`;
  }
  if (threadId) {
    env += `- Thread: ${threadDetails?.name || threadId}\n`;
  }
  sections.push(env);

  // 2.5 Installed Agents
  if (allAgents.length > 0) {
    const formatted = allAgents
      .map((a) => `- ${a.id}: ${a.name}${a.description ? ` - ${a.description}` : ''}`)
      .join('\n');
    sections.push(`## INSTALLED AGENTS\n${formatted}`);
  }

  // 3. Channel Spec
  const spec = channelDetails?.spec?.trim();
  if (spec) {
    sections.push(`## CHANNEL SPECIFICATION\n${spec}`);
  }

  // 4. Files
  if (storage?.listFiles && channelId && channelDetails?.cwd) {
    try {
      const files = await storage.listFiles({ channelId });
      if (files.length > 0) {
        const limited = files.slice(0, MAX_CONTEXT_FILES);
        const formatted = limited
          .map((f) => `- ${f.name}${f.isDirectory ? '/' : ''}`)
          .join('\n');
        let fileSection = `## FILES\n${formatted}`;
        if (files.length > MAX_CONTEXT_FILES) {
          fileSection += `\n- ... and ${files.length - MAX_CONTEXT_FILES} more files`;
        }
        sections.push(fileSection);
      } else {
        sections.push('## FILES\n- (No files in workspace)');
      }
    } catch (error) {
      console.warn('[context] Failed to fetch files:', error);
    }
  }

  // 5. Agent Instructions
  const rawInstructions = agentDetails?.instructions?.trim();
  if (
    rawInstructions &&
    rawInstructions !== OPENBOT_SYSTEM_PROMPT.trim()
  ) {
    sections.push(`## Instructions\n${rawInstructions}`);
  }

  // 6. Memories
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
