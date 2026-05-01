import { MelonyPlugin } from 'melony';
import z from 'zod';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import { mcpService } from '../services/mcp.js';

function stringifyResult(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export const mcpToolDefinitions = {
  mcp_list_tools: {
    description:
      'List available tools from a configured MCP server. Use this first before calling tools on an unknown server.',
    inputSchema: z.object({
      serverId: z.string().describe('Configured MCP server id (for example: github, notion, linear).'),
    }),
  },
  mcp_call: {
    description:
      'Call a tool on a configured MCP server. Provide tool arguments as a JSON object. Use mcp_list_tools first when uncertain.',
    inputSchema: z.object({
      serverId: z.string().describe('Configured MCP server id.'),
      toolName: z.string().describe('Exact MCP tool name from mcp_list_tools.'),
      args: z.record(z.string(), z.unknown()).default({}).describe('Tool arguments as a JSON object.'),
    }),
  },
};

export const mcpPlugin = (): MelonyPlugin<OpenBotState, OpenBotEvent> => (builder) => {
  builder.on('action:mcp_list_tools', async function* (event, context) {
    const serverId = (event.data as any)?.serverId as string;

    try {
      const tools = await mcpService.listTools(serverId);
      const toolNames = tools.map((tool) => `- ${tool.name}${tool.description ? `: ${tool.description}` : ''}`);

      yield {
        type: 'action:mcp_list_tools:result',
        data: {
          success: true,
          serverId,
          tools,
        },
        meta: event.meta,
      } as any;

      yield {
        type: 'agent:output',
        data: {
          content:
            toolNames.length > 0
              ? `MCP tools available on \`${serverId}\`:\n${toolNames.join('\n')}`
              : `MCP server \`${serverId}\` has no tools.`,
        },
        meta: {
          ...(event.meta || {}),
          agentId: context.state.agentId,
        },
      } as any;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown MCP error';
      yield {
        type: 'action:mcp_list_tools:result',
        data: {
          success: false,
          serverId,
          tools: [],
          error: message,
        },
        meta: event.meta,
      } as any;
      yield {
        type: 'agent:output',
        data: {
          content: `Failed to list MCP tools for \`${serverId}\`: ${message}`,
        },
        meta: {
          ...(event.meta || {}),
          agentId: context.state.agentId,
        },
      } as any;
    }
  });

  builder.on('action:mcp_call', async function* (event, context) {
    const serverId = (event.data as any)?.serverId as string;
    const toolName = (event.data as any)?.toolName as string;
    const args = ((event.data as any)?.args || {}) as Record<string, unknown>;

    try {
      const result = await mcpService.callTool(serverId, toolName, args);
      const rendered = stringifyResult(result);

      yield {
        type: 'action:mcp_call:result',
        data: {
          success: true,
          serverId,
          toolName,
          result,
        },
        meta: event.meta,
      } as any;

      yield {
        type: 'agent:output',
        data: {
          content: `MCP \`${serverId}.${toolName}\` result:\n\n${rendered}`,
        },
        meta: {
          ...(event.meta || {}),
          agentId: context.state.agentId,
        },
      } as any;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown MCP error';
      yield {
        type: 'action:mcp_call:result',
        data: {
          success: false,
          serverId,
          toolName,
          error: message,
        },
        meta: event.meta,
      } as any;
      yield {
        type: 'agent:output',
        data: {
          content: `MCP call failed for \`${serverId}.${toolName}\`: ${message}`,
        },
        meta: {
          ...(event.meta || {}),
          agentId: context.state.agentId,
        },
      } as any;
    }
  });
};

export const plugin = {
  name: 'mcp',
  description: 'Basic MCP integration for configured servers',
  factory: mcpPlugin,
  toolDefinitions: mcpToolDefinitions,
};
