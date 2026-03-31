import { z } from "zod";
import { memoryPlugin, memoryToolDefinitions, createMemoryPromptBuilder } from "../plugins/memory/index.js";
import { topicAgent } from "../agents/topic-agent.js";
import { llmPlugin } from "../plugins/llm/index.js";
import { PluginRegistry } from "../registry/index.js";
import { readAgentConfig } from "../registry/plugin-loader.js";

export function createManagerPlugin(
  model: any,
  resolvedModelId: string,
  resolvedBaseDir: string,
  registry: PluginRegistry
) {
  const agentIds = registry.getAgentIds();
  const allAgents = registry.getAgents();
  const buildMemoryPrompt = createMemoryPromptBuilder(resolvedBaseDir);

  const getAgentDescriptions = (memberIds?: string[], excludeId?: string) => {
    return allAgents
      .filter((a) => (!memberIds || memberIds.includes(a.id)) && a.id !== excludeId)
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
  };

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

          // 1. Determine Identity (Channel Manager)
          const managerId = state.channelManagerId || "you";
          const isChannel = !!state.conversationId?.startsWith("channel_");
          const members = state.channelMembers as Array<{ id: string; name: string }> | undefined;
          const memberIds = members?.map(m => m.id);

          let personaPrompt = `
<orchestrator>
Your goal is to solve user requests by delegating tasks to expert sub-agents.

**Directives**:
1. **Delegate**: Use \`delegateTask\` for any task matching an agent's description.
3. **Context**: Provide a clear, detailed task for the sub-agent. Pass any relevant user attachments.
4. **Report**: Summarize the sub-agent's work concisely for the user.
5. **Memory**: Use your memory tools (\`remember\`, \`recall\`) to maintain context across sessions.
6. **State**: Use \`updateSessionState\` to modify any value in the <session_state>.
</orchestrator>`;

          if (isChannel && managerId !== "you") {
            const managerAgent = allAgents.find(a => a.id === managerId);
            if (managerAgent && managerAgent.folder) {
              try {
                const config = await readAgentConfig(managerAgent.folder);
                personaPrompt = `
<identity>
You are acting as **${managerAgent.name}**, the manager of this channel.
Your personal instructions are:
${config.instructions}
</identity>

<orchestrator_mode>
In addition to your personal role, you are the **Manager** of this channel.
You have a team of member agents available to you. 
When a request comes in, decide if you should handle it yourself using your own capabilities (if any) or delegate it to one of your team members.

**Directives**:
1. **Lead**: Take ownership of the conversation and ensure the user's goal is met.
2. **Delegate**: Use \`delegateTask\` to hand off specialized tasks to your team members.
3. **Collaborate**: You are the primary point of contact. Summarize findings from members for the user.
</orchestrator_mode>`;
              } catch (err) {
                console.error(`Failed to read manager agent config for ${managerId}:`, err);
              }
            }
          }

          // 2. Filter Agent Descriptions
          const agentDescriptions = getAgentDescriptions(memberIds, managerId);

          // 3. Session State
          const standardKeys = ["messages", "agentStates", "usage", "cwd", "workspaceRoot", "title", "conversationId", "pendingAgentTasks", "channelMembers", "channelManagerId"];
          const customState: Record<string, any> = {};
          for (const key of Object.keys(state)) {
            if (!standardKeys.includes(key)) {
              customState[key] = state[key];
            }
          }

          const statePrompt = Object.keys(customState).length > 0
            ? `\n\n<session_state>\n${JSON.stringify(customState, null, 2)}\n</session_state>`
            : "";

          const channelContext = isChannel && members
            ? `\n\n<channel_context>
This is a shared channel. 
Members: ${members.map(m => `${m.name} (@${m.id})`).join(", ")}
Manager: ${managerId === "you" ? "The User" : managerId}
${(state.messages?.length || 0) <= 1 ? "\n**Important**: This is the very first message in this channel. As the manager, you should analyze the request and decide if you should handle it or delegate parts of it to your team members immediately." : ""}
</channel_context>`
            : "";

          return `
${personaPrompt}
${statePrompt}
${channelContext}

<agents>
${agentDescriptions}
</agents>${memoryPrompt}`;
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
