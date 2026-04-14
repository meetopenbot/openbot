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

export const createOpenBot = async ({
  agentId,
  instructions,
  plugins = [],
}: {
  agentId: string;
  instructions?: string;
  plugins?: (string | { name: string; config?: any })[];
}): Promise<Runtime<OpenBotState, OpenBotEvent>> => {
  const runtime = melony<OpenBotState, OpenBotEvent>()
    .on('user:input', async function* (event) {
      const mention = parseMention(event.data.content);

      // 1. Yield the user message (once, at the entry point)
      if (!event.meta?.delegation) {
        yield {
          type: 'client:ui:message',
          data: {
            content: event.data.content,
            role: 'user',
          },
          meta: {
            agentId,
          },
        };
      }

      // 2. Default behavior (thinking)
      yield {
        type: 'agent:input',
        data: {
          content: mention ? mention.stripped : event.data.content,
        },
      };
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
    const name = typeof p === 'string' ? p : p.name;
    const config = typeof p === 'string' ? {} : p.config || {};
    const plugin = await resolvePlugin(name, config, instructions);
    if (plugin) {
      runtime.use(plugin);
    }
  }

  return runtime.build();
};

