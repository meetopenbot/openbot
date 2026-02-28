import { melony, generateId, MelonyPlugin, Runtime } from "melony";
import { osAgent } from "./agents/os-agent.js";
import { topicAgent } from "./agents/topic-agent.js";
import { agentCreatorAgent } from "./agents/agent-creator.js";
import { plannerAgent } from "./agents/planner-agent.js";
import { brainPlugin, brainToolDefinitions, createBrainPromptBuilder } from "./plugins/brain/index.js";
import { llmPlugin } from "./plugins/llm/index.js";
import { loadConfig, resolvePath, DEFAULT_BASE_DIR } from "./config.js";
import { createModel, parseModelString } from "./models.js";
import { DEFAULT_MODEL_ID } from "./model-defaults.js";
import path from "node:path";
import { z } from "zod";
import { ChatEvent, ChatState } from "./types.js";

import { shellPlugin, shellToolDefinitions } from "./plugins/shell/index.js";
import { fileSystemPlugin, fileSystemToolDefinitions } from "./plugins/file-system/index.js";
import { approvalPlugin } from "./plugins/approval/index.js";

import { PluginRegistry, AgentRegistry, discoverYamlAgents, discoverTsAgents, loadPluginsFromDir } from "./registry/index.js";
import { ui } from "@melony/ui-kit";
import widgets from "./ui/widgets/index.js";

/**
 * Create the OpenBot runtime.
 *
 * Architecture:
 *  1. Each agent gets its own isolated melony runtime (no shared handlers or state).
 *  2. The manager has its own runtime with brain tools and a delegateTask tool.
 *  3. OpenBot runtime routes events between manager and agent runtimes.
 *  4. Plugins are only instantiated within the runtime that needs them — no duplication.
 */
export async function createOpenBot(options?: {
  openaiApiKey?: string;
  anthropicApiKey?: string;
}) {
  const config = loadConfig();
  const baseDir = config.baseDir || DEFAULT_BASE_DIR;
  const resolvedBaseDir = resolvePath(baseDir);
  const configuredModel = config.model || DEFAULT_MODEL_ID;
  const { provider, modelId } = parseModelString(configuredModel);
  const resolvedModelId = `${provider}/${modelId}`;
  const model = createModel(options);

  // ─── Plugin Registry ─────────────────────────────────────────────

  const pluginRegistry = new PluginRegistry();

  pluginRegistry.register({
    name: "shell",
    description: "Execute shell commands",
    toolDefinitions: shellToolDefinitions,
    factory: () => shellPlugin({ cwd: process.cwd() }),
  });

  pluginRegistry.register({
    name: "file-system",
    description: "Read, write, list, and delete files",
    toolDefinitions: fileSystemToolDefinitions,
    factory: () => fileSystemPlugin({ baseDir: "/" }),
  });

  pluginRegistry.register({
    name: "approval",
    description: "Require user approval for specific actions",
    toolDefinitions: {},
    factory: (options) => approvalPlugin(options),
  });

  // ─── Shared Plugins ──────────────────────────────────────────────

  const sharedPlugins = await loadPluginsFromDir(path.join(resolvedBaseDir, "plugins"));
  for (const p of sharedPlugins) {
    pluginRegistry.register(p);
    console.log(`[plugins] Loaded shared plugin: ${p.name}`);
  }

  // ─── Agent Registry ──────────────────────────────────────────────

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
    plugin: osAgent({ model: model as any }),
  });

  agentRegistry.register({
    name: "agent-creator",
    description: "Helps the user create and configure new custom OpenBot agents via natural language.",
    capabilities: {
      ...Object.fromEntries(
        Object.entries(fileSystemToolDefinitions).map(([k, v]) => [k, v.description])
      ),
    },
    plugin: agentCreatorAgent({ model: model as any }),
  });

  agentRegistry.register({
    name: "planner-agent",
    description: "Creates concise execution plans from user intent for OpenBot to run.",
    plugin: plannerAgent({ model: model as any }),
  });

  // Discover community / user agents from ~/.openbot/agents/
  const agentsDir = path.join(resolvedBaseDir, "agents");

  const [yamlAgents, tsAgents] = await Promise.all([
    discoverYamlAgents(agentsDir, pluginRegistry, model as any, options),
    discoverTsAgents(agentsDir, model as any, options),
  ]);

  for (const agent of [...yamlAgents, ...tsAgents]) {
    agentRegistry.register(agent);
  }

  // ─── Build Runtime ───────────────────────────────────────────────

  const allAgents = agentRegistry.getAll();
  const agentNames = agentRegistry.getNames();

  const buildBrainPrompt = createBrainPromptBuilder(baseDir);

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

  // The manager plugin composes brain, topic, and the manager LLM
  const managerPlugin = (builder: any) => {
    builder
      .use(brainPlugin({
        baseDir: resolvedBaseDir,
        allowSoulModification: false,
      }))
      .use(topicAgent({ model: model as any }))
      .use(llmPlugin({
        model: model as any,
        modelId: resolvedModelId,
        usageScope: "manager",
        system: async (context: any) => {
          const brainPrompt = await buildBrainPrompt(context);

          return `${brainPrompt}

<manager_core>
<role>
Your role is to be the central orchestrator of this system. Your primary goal is to solve user requests by managing your persistent memory and delegating tasks to expert sub-agents.
</role>

<operating_principles>
1. **Delegation is Key**: If a task requires specialized expertise (shell, files, browser, etc.), you **must** delegate to an expert agent via \`delegateTask\`.
2. **Use Planner for Complex Tasks**: For non-trivial multi-step tasks, delegate to \`planner-agent\` first, then execute that plan step-by-step via the relevant specialist agents.
3. **Context-Rich Delegation**: When calling \`delegateTask\`, provide a thorough, context-rich task description so the sub-agent can work independently. If the user included attachments, pass them through \`attachments\`.
4. **Concise Reporting**: After a sub-agent finishes, provide a high-level, concise summary to the user. Do not repeat technical details unless requested.
5. **Memory Management**: Use your brain tools (\`remember\`, \`recall\`, \`journal\`, etc.) to maintain continuity and preferences across sessions.
</operating_principles>
</manager_core>

<specialized_agents>
${agentDescriptions}
</specialized_agents>

<final_guidance>
Always remain professional and efficient. You manage the big picture; let the agents do the work.
</final_guidance>`;
        },
        promptInputType: "agent:input",
        actionResultInputType: "action:result",
        completionEventType: "agent:output",
        toolDefinitions: {
          ...brainToolDefinitions,
          delegateTask: {
            description: `Delegate a specialized task to another agent. Use this whenever a task matches the capabilities of one of the available agents.`,
            inputSchema: z.object({
              agent: z.enum(agentNames).describe("The specialized agent to use"),
              task: z.string().describe("The detailed task description for the agent"),
              budget: z.object({
                maxSteps: z.number().int().positive().optional(),
                maxTokens: z.number().int().positive().optional(),
              }).optional().describe("Optional execution budget constraints."),
              correlationId: z.string().optional().describe("Optional trace/correlation identifier."),
              attachments: z.array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  mimeType: z.string(),
                  size: z.number(),
                  url: z.string(),
                })
              ).optional().describe("Image/file attachments from the user message, if present."),
            }),
          },
        },
      }));
  };

  // Collect agents for the runtime (excludes topic since it's a manager plugin now)
  const runtimeAgents = allAgents.map((a) => ({
    name: a.name,
    description: a.description,
    plugin: a.plugin,
    capabilities: a.capabilities,
  }));

  // ─── Routing & Delegation Logic ──────────────────────────────────

  const agentRuntimes = new Map<string, Runtime<ChatState, ChatEvent>>();
  for (const agent of runtimeAgents) {
    const builder = melony<ChatState, ChatEvent>();
    builder.use(agent.plugin);
    agentRuntimes.set(agent.name, builder.build());
  }

  const managerBuilder = melony<ChatState, ChatEvent>();
  managerBuilder.use(managerPlugin);

  // The delegation plugin allows the manager to call sub-agents and wait for results.
  managerBuilder.use((builder) => {
    builder.on("action:delegateTask", async function* (event: any, context: any) {
      const { agent: agentName, task, attachments } = event.data;
      const agentRuntime = agentRuntimes.get(agentName);

      if (!agentRuntime) {
        yield {
          type: "action:result",
          data: {
            action: "delegateTask",
            result: `Error: Agent "${agentName}" not found.`,
            toolCallId: event.data.toolCallId,
          },
        };
        return;
      }

      const agentRunId = `delegate_${generateId()}`;

      // yield ui status event
      yield ui.event(widgets.status(`Delegating task to ${agentName}`, "info"));

      // Initialize agent isolated state if not present
      const state = context.state as ChatState;
      if (!state.agentStates) state.agentStates = {};
      if (!state.agentStates[agentName]) state.agentStates[agentName] = {};

      const agentState = state.agentStates[agentName];

      const agentIterator = agentRuntime.run(
        {
          type: "agent:input",
          data: { content: task, attachments },
        } as any,
        {
          runId: agentRunId,
          state: agentState as any,
        }
      );

      let lastAgentOutput = "";

      for await (const agentEvent of agentIterator) {
        // Forward agent events to the main runtime so the user sees progress
        yield agentEvent;

        if (agentEvent.type === "agent:output") {
          lastAgentOutput = (agentEvent.data as any).content || agentEvent.data as any;
        }
      }

      // Feedback the result back to the manager
      yield {
        type: "action:result",
        data: {
          action: "delegateTask",
          result: lastAgentOutput || "Task completed with no output.",
          toolCallId: event.data.toolCallId,
        },
      } as ChatEvent;
    });
  });

  const managerRuntime = managerBuilder.build();

  return {
    async *run(event: ChatEvent, context: { runId: string; state: ChatState }) {
      const { state } = context;

      // Ensure manager state exists
      if (!state.messages) state.messages = [];
      if (!state.agentStates) state.agentStates = {};

      console.log("event:::::", event);
      console.log("context:::::", context);

      // Handle direct agent routing (e.g. "@os list files")
      if (event.type === "agent:input") {
        const content = (event.data as any).content as string;
        if (content.startsWith("@")) {
          const match = content.match(/^@([a-zA-Z0-9_-]+)\s*(.*)$/);
          if (match) {
            const [, agentName, remaining] = match;
            const runtime = agentRuntimes.get(agentName);
            if (runtime) {
              const agentEvent = {
                ...event,
                type: "agent:input",
                data: {
                  content: remaining || "Hello",
                  attachments: (event.data as any).attachments,
                },
              } as any;

              if (!state.agentStates[agentName]) state.agentStates[agentName] = {};

              const iterator = runtime.run(agentEvent, {
                runId: context.runId,
                state: state.agentStates[agentName] as any,
              });
              for await (const e of iterator) yield e;
              return;
            }
          }
        }
      }

      // Default routing: translate user event to manager input
      const managerEvent = {
        ...event,
        type: "agent:input",
      } as ChatEvent;

      const iterator = managerRuntime.run(managerEvent, {
        runId: context.runId,
        state: state as any,
      });

      for await (const e of iterator) {
        console.log("e:::::", e);
        yield e;
      }
    },
  };
}
