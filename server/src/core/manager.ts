import { z } from "zod";
import { memoryPlugin, memoryToolDefinitions, createMemoryPromptBuilder } from "../plugins/memory/index.js";
import { topicAgent } from "../agents/topic-agent.js";
import { llmPlugin } from "../plugins/llm/index.js";
import { PluginRegistry } from "../registry/index.js";

export function createManagerPlugin(
  model: any,
  resolvedModelId: string,
  resolvedBaseDir: string,
  registry: PluginRegistry
) {
  const agentNames = registry.getAgentNames();
  const allAgents = registry.getAgents();
  const buildMemoryPrompt = createMemoryPromptBuilder(resolvedBaseDir);

  const agentDescriptions = allAgents
    .map((a) => {
      const tools = a.capabilities
        ? Object.entries(a.capabilities)
          .map(([name, desc]) => `    - ${name}: ${desc}`)
          .join("\n")
        : "";
      return `<agent name="${a.name}">
  <description>${a.description}</description>
${tools ? `  <capabilities>\n${tools}\n  </capabilities>` : ""}
</agent>`;
    })
    .join("\n\n");

  return (builder: any) => {
    builder
      .use(memoryPlugin({
        baseDir: resolvedBaseDir,
      }))
      .use(topicAgent({ model: model as any }))
      .use(llmPlugin({
        model: model as any,
        modelId: resolvedModelId,
        usageScope: "manager",
        system: async (context: any) => {
          const memoryPrompt = await buildMemoryPrompt(context);

          return `

<orchestrator>
Your goal is to solve user requests by delegating tasks to expert sub-agents.

**Directives**:
1. **Delegate**: Use \`delegateTask\` for any task matching an agent's description.
3. **Context**: Provide a clear, detailed task for the sub-agent. Pass any relevant user attachments.
4. **Report**: Summarize the sub-agent's work concisely for the user.
5. **Memory**: Use your memory tools (\`remember\`, \`recall\`) to maintain context across sessions.
</orchestrator>

<agents>
${agentDescriptions}
</agents>${memoryPrompt}`;
        },
        promptInputType: "agent:input",
        actionResultInputType: "action:result",
        completionEventType: "agent:output",
        toolDefinitions: {
          ...memoryToolDefinitions,
          delegateTask: {
            description: `Delegate a task to a specialized expert agent.`,
            inputSchema: z.object({
              agent: z.enum(agentNames as [string, ...string[]]).describe("The name of the agent to use"),
              task: z.string().describe("The task for the agent to perform"),
              attachments: z.array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  mimeType: z.string(),
                  size: z.number(),
                  url: z.string(),
                })
              ).optional().describe("Attachments to pass through to the agent"),
            }),
          },
        },
      }));
  };
}
