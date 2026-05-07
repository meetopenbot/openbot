import { melony, Runtime } from 'melony';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import { resolvePlugin } from '../registry/plugins.js';
import { storageService } from '../services/storage.js';
import { loadConfig, PluginSpec } from '../app/config.js';

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
 * Factory for creating an OpenBot Melony Runtime.
 */
export async function createAgentRuntime(
  state: OpenBotState,
): Promise<Runtime<OpenBotState, OpenBotEvent>> {
  // 1. Prepare instructions
  await enhanceInstructions(state);

  // 2. Initialize runtime with the agent plugin
  const runtime = melony<OpenBotState, OpenBotEvent>({
    initialState: state,
  });

  // 3. Normalize plugin specs:
  // - runtime can be a single spec or an array (for backward/forward compatibility)
  // - plugins remains supported as additional specs
  const runtimeSpecs = Array.isArray(state.agentDetails?.runtime)
    ? state.agentDetails.runtime
    : state.agentDetails?.runtime
      ? [state.agentDetails.runtime]
      : [];
  const { globalPlugins = [] } = loadConfig();
  const agentSpecs = [...runtimeSpecs, ...(state.agentDetails?.plugins || [])];
  const pluginSpecs = mergePluginSpecs(globalPlugins, agentSpecs);

  // 4. Load normalized plugins
  for (const p of pluginSpecs) {
    const name = typeof p === 'string' ? p : p?.name;
    if (!name || typeof name !== 'string') {
      continue;
    }

    const config = typeof p === 'string' ? {} : { ...(p.config || {}) };
    const plugin = await resolvePlugin(name, config);
    if (plugin) {
      runtime.use(plugin);
    }
  }

  return runtime.build();
}

function mergePluginSpecs(globalSpecs: PluginSpec[], agentSpecs: PluginSpec[]): PluginSpec[] {
  const specsByName = new Map<string, PluginSpec>();

  for (const spec of globalSpecs) {
    const name = typeof spec === 'string' ? spec : spec?.name;
    if (!name || typeof name !== 'string') continue;
    specsByName.set(name, spec);
  }

  // Agent-defined plugins override global ones with the same name.
  for (const spec of agentSpecs) {
    const name = typeof spec === 'string' ? spec : spec?.name;
    if (!name || typeof name !== 'string') continue;
    specsByName.set(name, spec);
  }

  return [...specsByName.values()];
}
