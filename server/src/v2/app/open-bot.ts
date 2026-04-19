import { melony, Runtime } from 'melony';
import { OpenBotEvent, OpenBotState } from './types.js';
import { resolvePlugin } from './plugins.js';
import { parseMention } from './utils.js';

export const createOpenBotRuntime = async ({
  state,
}: {
  state: OpenBotState;
}): Promise<Runtime<OpenBotState, OpenBotEvent>> => {
  const { agentId, agentDetails } = state;

  const runtime = melony<OpenBotState, OpenBotEvent>({
    initialState: state,
  })
    .on('agent:invoke', async function* (event) {
      const { content, agentId: targetAgentId } = event.data;

      // 1. Mentions are parsed only by the 'system' agent when no specific target is set.
      if (agentId === 'system' && !targetAgentId) {
        const mention = parseMention(content);
        if (mention) {
          // Re-invoke the specific agent mentioned.
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
    })
    .on('agent:output', async function* (event) {
      yield {
        type: 'client:ui:message',
        data: {
          content: event.data.content,
          role: 'assistant',
        },
        meta: {
          agentId,
          threadId: event.meta?.threadId,
        },
      };
    });

  // Load plugins from config
  for (const p of agentDetails?.plugins || []) {
    const name = typeof p === 'string' ? p : p?.name || 'Unknown Plugin';
    // If the plugin is a string, use the default config
    // If the plugin is an object, use the config and merge it with the instructions
    const config = typeof p === 'string' ? {} : typeof p === 'object' ? { ...p.config } : {};
    const plugin = await resolvePlugin(name, config);

    // register the plugin
    if (plugin) {
      runtime.use(plugin);
    }
  }

  return runtime.build();
};
