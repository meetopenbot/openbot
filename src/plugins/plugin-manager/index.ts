import type { Plugin } from '../../services/plugins/types.js';
import { STATE_AGENT_ID } from '../../app/agent-ids.js';
import { OpenBotEvent } from '../../app/types.js';
import {
  pluginService,
  resolveMarketplaceAgentList,
} from '../../services/plugins/service.js';

/**
 * `plugin-manager` — marketplace listing, npm plugin install/uninstall, and
 * installing agents from the registry. Wired on the **`state`** built-in agent
 * via its default `pluginRefs`.
 *
 * Handlers register only when `agentId === state` so attaching this plugin to
 * other agents via AGENT.md does not widen infra privileges.
 */

export const pluginManagerPlugin: Plugin = {
  id: 'plugin-manager',
  name: 'Plugin manager',
  description:
    'Marketplace listings, npm-based plugin lifecycle, and agent installs from marketplace metadata.',
  factory: ({ agentId, storage }) => {
    if (agentId !== STATE_AGENT_ID) {
      return () => {};
    }

    return (builder) => {
      builder.on('action:plugin:install', async function* (event) {
        try {
          const { name, version } = event.data;
          const result = await pluginService.install({ packageName: name, version });
          yield {
            type: 'action:plugin:install:result',
            data: { success: true, plugin: result },
          } as OpenBotEvent;
        } catch (error) {
          yield {
            type: 'action:plugin:install:result',
            data: { success: false, error: (error as Error).message },
          } as OpenBotEvent;
        }
      });

      builder.on('action:plugin:uninstall', async function* (event) {
        try {
          await pluginService.uninstall(event.data.id);
          yield { type: 'action:plugin:uninstall:result', data: { success: true } };
        } catch (error) {
          yield {
            type: 'action:plugin:uninstall:result',
            data: { success: false, error: (error as Error).message },
          } as OpenBotEvent;
        }
      });

      builder.on('action:marketplace:list', async function* () {
        const agents = await resolveMarketplaceAgentList();
        yield {
          type: 'action:marketplace:list:result',
          data: { success: true, agents },
        } as OpenBotEvent;
      });

      builder.on('action:agent:install', async function* (event) {
        try {
          const {
            agentId: newAgentId,
            name,
            description,
            image,
            instructions,
            plugins,
          } = event.data;

          for (const ref of plugins) {
            const installed = await pluginService.isInstalled(ref.id);
            if (!installed && ref.id.includes('/') === false && ref.id.includes('-plugin-') === false) {
              continue;
            }
            if (!installed) {
              try {
                await pluginService.install({ packageName: ref.id });
              } catch (err) {
                console.warn(`[plugins] Failed to pre-install plugin ${ref.id}`, err);
              }
            }
          }

          await storage.createAgent({
            agentId: newAgentId,
            name,
            description,
            image,
            instructions,
            plugins,
          });
          yield {
            type: 'action:agent:install:result',
            data: { success: true, agentId: newAgentId },
          } as OpenBotEvent;
          yield {
            type: 'agent:output',
            data: {
              content: `Successfully installed agent **${name}** (${newAgentId}) from marketplace.`,
            },
            meta: { agentId: 'system' },
          } as OpenBotEvent;
        } catch (error) {
          yield {
            type: 'action:agent:install:result',
            data: {
              success: false,
              agentId: event.data.agentId,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          } as OpenBotEvent;
        }
      });
    };
  },
};
