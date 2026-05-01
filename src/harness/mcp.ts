import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadConfig, type MCPServerConfig } from '../app/config.js';

type MCPToolSummary = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

class MCPService {
  private clients = new Map<string, Client>();

  private transports = new Map<string, StdioClientTransport>();

  private getServerConfig(serverId: string): MCPServerConfig {
    const config = loadConfig();
    const server = (config.mcpServers || []).find((s) => s.id === serverId);
    if (!server) {
      throw new Error(`MCP server "${serverId}" is not configured`);
    }
    return server;
  }

  private async getClient(serverId: string): Promise<Client> {
    const existing = this.clients.get(serverId);
    if (existing) {
      return existing;
    }

    const server = this.getServerConfig(serverId);
    const client = new Client(
      {
        name: 'openbot-v2',
        version: '0.1.0',
      },
      {
        capabilities: {},
      },
    );
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args || [],
      env: server.env,
      cwd: server.cwd,
    });

    await client.connect(transport);
    this.clients.set(serverId, client);
    this.transports.set(serverId, transport);
    return client;
  }

  async listServers(): Promise<string[]> {
    const config = loadConfig();
    return (config.mcpServers || []).map((server) => server.id);
  }

  async listTools(serverId: string): Promise<MCPToolSummary[]> {
    const client = await this.getClient(serverId);
    const result = await client.listTools();
    return (result.tools || []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>) {
    const client = await this.getClient(serverId);
    return client.callTool({
      name: toolName,
      arguments: args,
    });
  }
}

export const mcpService = new MCPService();
