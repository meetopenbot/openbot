import { MelonyPlugin } from 'melony';
import z from 'zod';
import type { Plugin } from '../../bus/plugin.js';
import { OpenBotEvent, OpenBotState } from '../../app/types.js';
import { mcpService } from '../../harness/mcp.js';

function stringifyResult(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const mcpToolDefinitions = {
  mcp_list_tools: {
    description:
      'List available tools from a configured MCP server. Use this first before calling tools on an unknown server.',
    inputSchema: z.object({
      serverId: z.string().describe('Configured MCP server id (e.g. github, notion, linear).'),
    }),
  },
  mcp_call: {
    description:
      'Call a tool on a configured MCP server. Provide tool arguments as a JSON object. Use mcp_list_tools first when uncertain.',
    inputSchema: z.object({
      serverId: z.string().describe('Configured MCP server id.'),
      toolName: z.string().describe('Exact MCP tool name from mcp_list_tools.'),
      args: z
        .record(z.string(), z.unknown())
        .default({})
        .describe('Tool arguments as a JSON object.'),
    }),
  },
};

const mcpPluginRuntime = (): MelonyPlugin<OpenBotState, OpenBotEvent> => (builder) => {
  builder.on('action:mcp_list_tools', async function* (event, context) {
    const serverId = (event.data as { serverId?: string })?.serverId as string;

    try {
      const tools = await mcpService.listTools(serverId);
      const toolNames = tools.map(
        (tool) => `- ${tool.name}${tool.description ? `: ${tool.description}` : ''}`,
      );

      yield {
        type: 'action:mcp_list_tools:result',
        data: { success: true, serverId, tools },
        meta: event.meta,
      } as OpenBotEvent;

      yield {
        type: 'agent:output',
        data: {
          content:
            toolNames.length > 0
              ? `MCP tools available on \`${serverId}\`:\n${toolNames.join('\n')}`
              : `MCP server \`${serverId}\` has no tools.`,
        },
        meta: { ...(event.meta || {}), agentId: context.state.agentId },
      } as OpenBotEvent;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown MCP error';
      yield {
        type: 'action:mcp_list_tools:result',
        data: { success: false, serverId, tools: [], error: message },
        meta: event.meta,
      } as OpenBotEvent;
      yield {
        type: 'agent:output',
        data: { content: `Failed to list MCP tools for \`${serverId}\`: ${message}` },
        meta: { ...(event.meta || {}), agentId: context.state.agentId },
      } as OpenBotEvent;
    }
  });

  builder.on('action:mcp_call', async function* (event, context) {
    const data = event.data as {
      serverId?: string;
      toolName?: string;
      args?: Record<string, unknown>;
    };
    const serverId = data?.serverId as string;
    const toolName = data?.toolName as string;
    const args = (data?.args || {}) as Record<string, unknown>;

    try {
      const result = await mcpService.callTool(serverId, toolName, args);
      const rendered = stringifyResult(result);

      yield {
        type: 'action:mcp_call:result',
        data: { success: true, serverId, toolName, result },
        meta: event.meta,
      } as OpenBotEvent;

      yield {
        type: 'agent:output',
        data: { content: `MCP \`${serverId}.${toolName}\` result:\n\n${rendered}` },
        meta: { ...(event.meta || {}), agentId: context.state.agentId },
      } as OpenBotEvent;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown MCP error';
      yield {
        type: 'action:mcp_call:result',
        data: { success: false, serverId, toolName, error: message },
        meta: event.meta,
      } as OpenBotEvent;
      yield {
        type: 'agent:output',
        data: { content: `MCP call failed for \`${serverId}.${toolName}\`: ${message}` },
        meta: { ...(event.meta || {}), agentId: context.state.agentId },
      } as OpenBotEvent;
    }
  });
};

export const mcpPlugin: Plugin = {
  id: 'mcp',
  name: 'MCP',
  description: 'Connect to Model Context Protocol servers and call their tools.',
  toolDefinitions: mcpToolDefinitions,
  factory: () => mcpPluginRuntime(),
};

export default mcpPlugin;
