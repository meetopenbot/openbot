import { melony, MelonyPlugin, Runtime } from 'melony';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import type { Plugin, PluginContext, ToolDefinition } from '../bus/plugin.js';
import { resolvePlugin } from '../registry/plugins.js';
import { storageService } from '../services/storage.js';
import { busServicesPlugin } from '../bus/services.js';

/**
 * Enhances the agent's instructions with a list of other available agents the
 * orchestrator can hand off to. Agents that include the `delegation` plugin
 * will surface peers; agents without it can ignore this.
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

    const header = '### Available Agents for Handoff:';
    if (!agentDetails.instructions.includes(header)) {
      agentDetails.instructions +=
        `\n\n${header}\n${agentsList}\n\n` +
        'Use `handoff` to transfer control to another agent in this thread.';
    }
  } catch (error) {
    console.warn('[agent] Failed to enhance instructions', error);
  }
}

const composeMelonyPlugin = (
  ...plugins: MelonyPlugin<OpenBotState, OpenBotEvent>[]
): MelonyPlugin<OpenBotState, OpenBotEvent> => {
  return (builder) => {
    for (const plugin of plugins) {
      plugin(builder);
    }
  };
};

/**
 * Build the Melony runtime that drives a single agent run on the OpenBot bus.
 *
 * The runtime always wires:
 *   1. `busServicesPlugin` — bus-level services (storage, channels, threads,
 *      plugin install/marketplace) shared by every agent.
 *   2. Every Plugin referenced by the agent's `plugins[]` frontmatter, in
 *      order. Tool definitions from each plugin are merged into a single map
 *      and passed to every plugin via `PluginContext.tools`. Runtime plugins
 *      (those that handle `agent:invoke`) consume the merged map; tool plugins
 *      ignore it.
 *
 * Tool name collisions across plugins log a warning; the first plugin wins.
 */
export async function createAgentRuntime(
  state: OpenBotState,
): Promise<Runtime<OpenBotState, OpenBotEvent>> {
  await enhanceInstructions(state);

  const runtime = melony<OpenBotState, OpenBotEvent>({
    initialState: state,
  });

  runtime.use(busServicesPlugin({ storage: storageService }));

  const refs = state.agentDetails?.pluginRefs || [];
  if (refs.length === 0) {
    console.warn(
      `[agent] Agent "${state.agentId}" has no plugins; only bus services will be active.`,
    );
    return runtime.build();
  }

  // Resolve all plugins first so we can merge tool definitions before factory calls.
  const resolved: Array<{ ref: { id: string; config?: Record<string, unknown> }; plugin: Plugin }> = [];
  for (const ref of refs) {
    const plugin = await resolvePlugin(ref.id);
    if (!plugin) {
      console.warn(
        `[agent] Plugin "${ref.id}" for agent "${state.agentId}" could not be resolved.`,
      );
      continue;
    }
    resolved.push({ ref, plugin });
  }

  // Merge tool definitions; first plugin wins on collision.
  const tools: Record<string, ToolDefinition> = {};
  for (const { plugin } of resolved) {
    if (!plugin.toolDefinitions) continue;
    for (const [name, def] of Object.entries(plugin.toolDefinitions)) {
      if (tools[name]) {
        console.warn(
          `[agent] Tool name collision for "${name}" while loading plugin "${plugin.id}"; keeping first registration.`,
        );
        continue;
      }
      tools[name] = def;
    }
  }

  // Compose all plugin factories with the shared context.
  const pluginPlugins: MelonyPlugin<OpenBotState, OpenBotEvent>[] = [];
  for (const { ref, plugin } of resolved) {
    const context: PluginContext = {
      agentId: state.agentId,
      agentDetails: state.agentDetails!,
      config: ref.config || {},
      storage: storageService,
      tools,
    };
    pluginPlugins.push(plugin.factory(context));
  }

  runtime.use(composeMelonyPlugin(...pluginPlugins));

  return runtime.build();
}
