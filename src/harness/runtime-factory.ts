import { melony, MelonyPlugin, Runtime } from 'melony';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import type { Plugin, PluginContext, ToolDefinition } from '../bus/plugin.js';
import { resolvePlugin } from '../registry/plugins.js';
import { storageService } from '../services/storage.js';
import { busServicesPlugin } from '../bus/services.js';
import { isDmSoloChannel } from './channel-participants.js';

const AVAILABLE_AGENTS_HEADER = '### Available agents (this channel)';
const DM_CHANNEL_HEADER = '### Direct message channel';

/**
 * Enhances instructions using channel `participants`:
 *
 * - **DM (single participant = this agent)**: no peer list; todos are
 *   scoped to solo use.
 * - **Participants set**: lists only those agents (excluding self) that may
 *   collaborate in this channel.
 * - **No participants**: omit the peer list (legacy channels are not assumed to
 *   be open to every registered agent).
 *
 * Agents with `todo` get matching usage hints.
 */
export async function enhanceInstructions(state: OpenBotState) {
  const { agentId, agentDetails, channelDetails } = state;
  if (!agentDetails) return;

  try {
    const participants = (channelDetails?.participants ?? []).filter(
      (id): id is string => typeof id === 'string' && id.trim() !== '',
    );
    const participantSet = new Set(participants.map((p) => p.trim()));

    const allAgents = await storageService.getAgents();
    const hasTodo = (agentDetails.pluginRefs || []).some((r) => r.id === 'todo');

    const isDmSolo = isDmSoloChannel(participants, agentId);

    if (isDmSolo) {
      if (!agentDetails.instructions.includes(DM_CHANNEL_HEADER)) {
        const dmLines = [
          DM_CHANNEL_HEADER,
          'You are the only agent in this direct-message channel. There are no peer agents and no multi-agent workflows.',
        ];
        if (hasTodo) {
          dmLines.push(
            `Use \`todo_write\` only for your own step-by-step planning when helpful; omit \`assignee\` on items or set it to \`${agentId}\`. The todo list is yours alone — ignore generic instructions elsewhere about coordinating other agents in this thread.`,
          );
        }
        agentDetails.instructions += `\n\n${dmLines.join('\n')}`;
      }
      return;
    }

    if (participantSet.size === 0) return;
    if (agentDetails.instructions.includes(AVAILABLE_AGENTS_HEADER)) return;

    const peerIds = [...participantSet].filter((id) => id !== agentId);
    if (peerIds.length === 0) return;

    const agentsList = peerIds
      .map((id) => {
        const a = allAgents.find((x) => x.id === id);
        return a
          ? `- **${a.id}**${a.description ? `: ${a.description}` : ''}`
          : `- **${id}**`;
      })
      .join('\n');

    let usage = '';
    if (hasTodo) {
      usage =
        'Use these ids as `assignee` when calling \`todo_write\`; only agents listed here participate in this channel.';
    }

    agentDetails.instructions += `\n\n${AVAILABLE_AGENTS_HEADER}\n${agentsList}${usage ? `\n\n${usage}` : ''}`;
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
