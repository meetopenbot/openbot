import { melony, Runtime } from 'melony';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import { resolveAgentPackage } from '../registry/agents.js';
import { storageService } from '../services/storage.js';
import { busServicesPlugin } from '../bus/services.js';

/**
 * Enhances the agent's instructions with a list of other available agents the
 * orchestrator can hand off / delegate to. The OpenBot orchestrator relies on
 * this to surface peers; other agent packages may ignore this enhancement.
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

    const header = '### Available Agents for Handoff/Delegation:';
    if (!agentDetails.instructions.includes(header)) {
      agentDetails.instructions +=
        `\n\n${header}\n${agentsList}\n\n` +
        'Use `handoff` to transfer control to another agent. ' +
        'Use `delegate` when you need a sub-result from another agent and want to continue after it returns.';
    }
  } catch (error) {
    console.warn('[agent] Failed to enhance instructions', error);
  }
}

/**
 * Build the Melony runtime that drives a single agent run on the OpenBot bus.
 *
 * The runtime always wires:
 *   1. `busServicesPlugin` — bus-level services (storage, channels, threads,
 *      agent registry, agent-package install/marketplace) shared by every agent.
 *   2. The agent's `AgentPackage` factory — the agent's own behaviour
 *      (`agent:invoke` handler + tool implementations + middleware).
 */
export async function createAgentRuntime(
  state: OpenBotState,
): Promise<Runtime<OpenBotState, OpenBotEvent>> {
  await enhanceInstructions(state);

  const runtime = melony<OpenBotState, OpenBotEvent>({
    initialState: state,
  });

  runtime.use(busServicesPlugin({ storage: storageService }));

  const packageId = state.agentDetails?.packageId;
  if (!packageId) {
    console.warn(
      `[agent] Agent "${state.agentId}" has no packageId; only bus services will be active.`,
    );
    return runtime.build();
  }

  const pkg = await resolveAgentPackage(packageId);
  if (!pkg) {
    console.warn(
      `[agent] AgentPackage "${packageId}" for agent "${state.agentId}" could not be resolved.`,
    );
    return runtime.build();
  }

  const factoryPlugin = pkg.factory({
    agentId: state.agentId,
    agentDetails: state.agentDetails!,
    config: state.agentDetails!.config || {},
    storage: storageService,
  });

  runtime.use(factoryPlugin);

  return runtime.build();
}
