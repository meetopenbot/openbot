import { MelonyPlugin } from 'melony';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import { storageService } from '../services/storage.js';

/**
 * Agent Plugin for OpenBot.
 * Handles the base agent logic:
 * 1. Standard Output (Formatting for UI)
 * 2. Instruction Enhancement (Adding available agents to system prompt)
 */
export const agentPlugin = (): MelonyPlugin<OpenBotState, OpenBotEvent> => (builder) => {
  builder.on('agent:output', async function* (event, { state }) {
    yield {
      type: 'client:ui:message',
      data: {
        content: event.data.content,
        role: 'assistant',
      },
      meta: {
        agentId: state.agentId,
        threadId: event.meta?.threadId,
      },
    };
  });
};

/**
 * Enhances agent instructions with a list of other available agents.
 */
export async function enhanceInstructions(state: OpenBotState) {
  const { agentId, agentDetails } = state;
  if (!agentDetails) return;

  try {
    const agents = await storageService.getAgents();
    const otherAgents = agents.filter((a) => a.id !== agentId);
    if (otherAgents.length === 0) return;

    const agentsList = otherAgents
      .map((a) => `- **${a.id}**${a.description ? `: ${a.description}` : ''}`)
      .join('\n');

    const header = '### Available Agents for Delegation:';
    if (!agentDetails.instructions.includes(header)) {
      agentDetails.instructions += `\n\n${header}\n${agentsList}\n\nYou can use the \`delegate\` tool to task these agents. Use their ID (the bold part) when delegating.`;
    }
  } catch (error) {
    console.warn('[agent] Failed to enhance instructions', error);
  }
}
