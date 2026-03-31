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
  const agentIds = registry.getAgentIds();
  const allAgents = registry.getAgents();
  const buildMemoryPrompt = createMemoryPromptBuilder(resolvedBaseDir);

  const agentDescriptions = allAgents
    .map((a) => {
      const tools = a.capabilities
        ? Object.entries(a.capabilities)
          .map(([name, desc]) => `    - ${name}: ${desc}`)
          .join("\n")
        : "";
      return `<agent id="${a.id}" name="${a.name}">
  <description>${a.description}</description>
${tools ? `  <capabilities>\n${tools}\n  </capabilities>` : ""}
</agent>`;
    })
    .join("\n\n");

  console.log("agentIds", agentIds);
  console.log("agentDescriptions", agentDescriptions);

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
          const state = context.state as any;

          // Deterministically inject any custom state keys into the prompt
          const standardKeys = ["messages", "agentStates", "usage", "cwd", "workspaceRoot", "title", "conversationId", "pendingAgentTasks"];
          const customState: Record<string, any> = {};
          for (const key of Object.keys(state)) {
            if (!standardKeys.includes(key)) {
              customState[key] = state[key];
            }
          }

          const statePrompt = Object.keys(customState).length > 0
            ? `\n\n<session_state>\n${JSON.stringify(customState, null, 2)}\n</session_state>`
            : "";

          const finalSystemPrompt = `

<orchestrator>
Your goal is to solve user requests by delegating tasks to expert sub-agents.

**Directives**:
1. **Delegate**: Use \`delegateTask\` for any task matching an agent's description.
3. **Context**: Provide a clear, detailed task for the sub-agent. Pass any relevant user attachments.
4. **Report**: Summarize the sub-agent's work concisely for the user.
5. **Memory**: Use your memory tools (\`remember\`, \`recall\`) to maintain context across sessions.
6. **State**: Use \`updateSessionState\` to modify any value in the <session_state>.
</orchestrator>

${statePrompt}

<agents>
${agentDescriptions}
</agents>${memoryPrompt}`

          // console.log("finalSystemPrompt:::::", finalSystemPrompt);

          return finalSystemPrompt;
        },
        toolDefinitions: {
          ...memoryToolDefinitions,
          delegateTask: {
            description: `Delegate a task to a specialized expert agent.`,
            inputSchema: z.object({
              agentId: z.enum(agentIds as [string, ...string[]]).describe("The ID of the agent to use"),
              task: z.string().describe("The task for the agent to perform"),
              stateKey: z.string().optional().describe("Optional key to store structured JSON result in the session state"),
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
          updateSessionState: {
            description: "Update a value in the session state using a JSON path.",
            inputSchema: z.object({
              path: z.string().describe("The JSON path to the value (e.g. 'project_plan.todos.0.status')"),
              value: z.any().describe("The new value to set"),
            }),
          },
        },
      }));
  };
}
