import { osAgent } from "../agents/os-agent.js";
import { agentCreatorAgent } from "../agents/agent-creator.js";
import { plannerAgent } from "../agents/planner-agent.js";
import { shellToolDefinitions } from "../plugins/shell/index.js";
import { fileSystemToolDefinitions } from "../plugins/file-system/index.js";
import { AgentRegistry, discoverYamlAgents, discoverTsAgents, PluginRegistry } from "../registry/index.js";
import path from "node:path";

export async function setupAgentRegistry(
  resolvedBaseDir: string,
  pluginRegistry: PluginRegistry,
  model: any,
  options: any
): Promise<AgentRegistry> {
  const agentRegistry = new AgentRegistry();

  agentRegistry.register({
    name: "os",
    description: "Handles shell commands and file system operations",
    capabilities: {
      ...Object.fromEntries(
        Object.entries(shellToolDefinitions).map(([k, v]) => [k, v.description])
      ),
      ...Object.fromEntries(
        Object.entries(fileSystemToolDefinitions).map(([k, v]) => [k, v.description])
      ),
    },
    plugin: osAgent({ model }),
  });

  agentRegistry.register({
    name: "agent-creator",
    description: "Helps the user create and configure new custom OpenBot agents via natural language.",
    capabilities: {
      ...Object.fromEntries(
        Object.entries(fileSystemToolDefinitions).map(([k, v]) => [k, v.description])
      ),
    },
    plugin: agentCreatorAgent({ model }),
  });

  agentRegistry.register({
    name: "planner-agent",
    description: "Creates concise execution plans from user intent for OpenBot to run.",
    plugin: plannerAgent({ model }),
  });

  const agentsDir = path.join(resolvedBaseDir, "agents");
  const [yamlAgents, tsAgents] = await Promise.all([
    discoverYamlAgents(agentsDir, pluginRegistry, model, options),
    discoverTsAgents(agentsDir, model, options),
  ]);

  for (const agent of [...yamlAgents, ...tsAgents]) {
    agentRegistry.register(agent);
  }

  return agentRegistry;
}
