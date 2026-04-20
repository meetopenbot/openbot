import { MelonyPlugin, Runtime } from 'melony';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import { parseMention } from '../app/utils.js';
import { storageService } from '../services/storage.js';

/**
 * Agent Plugin for OpenBot.
 * Handles the base agent logic:
 * 1. Mentions/Routing (@agent)
 * 2. Delegation yielding
 * 3. Standard Output (Formatting for UI)
 * 4. Instruction Enhancement (Adding available agents to system prompt)
 */
export const agentPlugin = (): MelonyPlugin<OpenBotState, OpenBotEvent> => (builder) => {
  builder.on('agent:invoke', async function* (event, { state }) {
    const { agentId } = state;
    const { content, agentId: targetAgentId } = event.data;

    // 1. Mentions are parsed only by the 'system' agent when no specific target is set.
    if (agentId === 'system' && !targetAgentId) {
      const mention = parseMention(content);
      if (mention) {
        yield {
          type: 'agent:invoke',
          data: {
            agentId: mention.agentId,
            content: mention.stripped,
          },
        };
        return;
      }
    }

    // Delegation yielding: coordinatorService will catch this and start a new agent
    if (targetAgentId && targetAgentId !== agentId) {
      yield event;
    }
  });

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
