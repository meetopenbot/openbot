import { melony, Runtime } from 'melony';
import { OpenBotEvent, OpenBotState } from './types.js';
import { resolvePlugin } from './plugins.js';

/**
 * Detects mentions in the text, returns the first agentId found,
 * and the content with ALL mentions removed.
 */
function parseMention(content: string) {
  const mentionPattern = /@([a-z0-9-_]+)/gi;
  const matches = [...content.matchAll(mentionPattern)];

  if (matches.length === 0) return null;

  // Route to the FIRST mention
  const targetAgentId = matches[0][1].toLowerCase();

  // Strip ALL mentions from the text to keep the agent prompt clean
  const stripped = content.replace(mentionPattern, '').trim();

  return { agentId: targetAgentId, stripped };
}

export const createOpenBotRuntime = async ({
  agentId,
  instructions,
  plugins = [],
}: {
  agentId: string;
  instructions?: string;
  plugins?: (string | { name: string; config?: any })[];
}): Promise<Runtime<OpenBotState, OpenBotEvent>> => {
  const runtime = melony<OpenBotState, OpenBotEvent>()
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
        },
      };
    });

  // Load plugins from config
  for (const p of plugins) {
    const name = typeof p === 'string' ? p : p?.name || 'Unknown Plugin';
    // If the plugin is a string, use the default config
    // If the plugin is an object, use the config and merge it with the instructions
    const config = typeof p === 'string' ? {} : typeof p === 'object' ? { instructions, ...p } : {};
    const plugin = await resolvePlugin(name, config, instructions);
    if (plugin) {
      runtime.use(plugin);
    }
  }

  return runtime.build();
};
