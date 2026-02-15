import { melony } from "melony";
import { ChatEvent, ChatState } from "./types.js";
import { osAgent } from "./agents/os-agent.js";
import { topicAgent } from "./agents/topic-agent.js";
import { brainPlugin, brainToolDefinitions, createBrainPromptBuilder } from "./plugins/brain/index.js";
import { llmPlugin } from "./plugins/llm/index.js";
import { initHandler } from "./handlers/init.js";
import { sessionChangeHandler } from "./handlers/session-change.js";
import { tabChangeHandler } from "./handlers/tab-change.js";
import { updateSettingsHandler, openAgentFolderHandler } from "./handlers/settings.js";
import { loadConfig, resolvePath, DEFAULT_BASE_DIR } from "./config.js";
import { createModel } from "./models.js";
import path from "node:path";
import { z } from "zod";

// Plugin imports for the registry
import { shellPlugin, shellToolDefinitions } from "./plugins/shell/index.js";
import { fileSystemPlugin, fileSystemToolDefinitions } from "./plugins/file-system/index.js";

// Registry
import { PluginRegistry, AgentRegistry, discoverYamlAgents, loadPluginsFromDir } from "./registry/index.js";

/**
 * Create the OpenBot manager agent.
 *
 * Architecture:
 *  1. Built-in plugins are registered in the Plugin Registry so YAML agents can reference them by name.
 *  2. Built-in agents + YAML agents discovered from ~/.openbot/agents/ are registered in the Agent Registry.
 *  3. The manager LLM gets a dynamically-built `delegateTask` tool listing all registered agents.
 *  4. A generic delegation handler + bridge-back wiring replaces per-agent boilerplate.
 */
export async function createOpenBot(options?: {
  openaiApiKey?: string;
  anthropicApiKey?: string;
}) {
  const config = loadConfig();
  const baseDir = config.baseDir || DEFAULT_BASE_DIR;
  const resolvedBaseDir = resolvePath(baseDir);
  const model = createModel(options);

  // ─── Plugin Registry ─────────────────────────────────────────────
  // Register built-in plugins so YAML agents can reference them by name.

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

  // ─── Shared Plugins ──────────────────────────────────────────────
  // Load community/user plugins from ~/.openbot/plugins/
  const sharedPlugins = await loadPluginsFromDir(path.join(resolvedBaseDir, "plugins"));
  for (const p of sharedPlugins) {
    pluginRegistry.register(p);
    console.log(`[plugins] Loaded shared plugin: ${p.name}`);
  }

  // ─── Agent Registry ──────────────────────────────────────────────
  // Register built-in agents, then discover YAML agents from ~/.openbot/agents/.

  const agentRegistry = new AgentRegistry();

  agentRegistry.register({
    name: "os",
    description: "Handles shell commands and file system operations",
    capabilities: {
      ...Object.fromEntries(
        Object.entries(shellToolDefinitions).map(([k, v]) => [k, v.description])
      ),
      ...Object.fromEntries(
        Object.entries(fileSystemToolDefinitions).map(([k, v]) => [
          k,
          v.description,
        ])
      ),
    },
    plugin: osAgent({ model: model as any }),
  });

  agentRegistry.register({
    name: "topic",
    description: "Automatically titles threads",
    plugin: topicAgent({ model: model as any }),
    subscribe: ["manager:completion"],
  });

  // Discover community / user agents from ~/.openbot/agents/
  const yamlAgents = await discoverYamlAgents(
    path.join(resolvedBaseDir, "agents"),
    pluginRegistry,
    model as any,
    options,
  );

  for (const agent of yamlAgents) {
    agentRegistry.register(agent);
  }

  // ─── Compose the Melony App ──────────────────────────────────────

  const allAgents = agentRegistry.getAll();
  const agentNames = agentRegistry.getNames();

  const app = melony<ChatState, ChatEvent>();

  // 1. Register all agent plugins
  for (const agent of allAgents) {
    app.use(agent.plugin);

    // Choreography bridge: Auto-wire subscriptions
    if (agent.subscribe) {
      for (const eventType of agent.subscribe) {
        app.on(eventType as any, async function* (event, { state }) {
          // Avoid self-triggering if the event has agent meta
          if ((event as any).meta?.agent === agent.name) return;

          yield {
            type: `agent:${agent.name}:input`,
            data: {
              content: `Event observed: ${event.type}\nData: ${JSON.stringify(event.data)}`,
            },
            meta: {
              background: true,
              agent: agent.name
            },
          };
        });
      }
    }
  }

  // 2. Register global plugins (brain, UI, etc.)
  const buildBrainPrompt = createBrainPromptBuilder(baseDir);

  app
    .use(brainPlugin({
      baseDir: resolvedBaseDir,
      allowSoulModification: false,
    }));

  // 3. Build dynamic delegation tool from the agent registry
  const agentDescriptions = allAgents
    .map((a) => {
      const tools = a.capabilities
        ? Object.entries(a.capabilities)
          .map(([name, desc]) => `    - ${name}: ${desc}`)
          .join("\n")
        : "";
      return `- **${a.name}**: ${a.description}${tools ? `\n  Capabilities:\n${tools}` : ""
        }`;
    })
    .join("\n\n");

  app.use(
    llmPlugin({
      model: model as any,
      system: async (context) => {
        const [brainPrompt] = await Promise.all([
          buildBrainPrompt(context),
        ]);

        return `${brainPrompt}

## Delegation & Specialized Agents
You are the **Manager Agent**. Your primary role is to orchestrate tasks by delegating them to specialized agents when appropriate. 
If a task falls outside your core capabilities (memory and orchestration), you **MUST** use the \`delegateTask\` tool.

### Available Agents:
${agentDescriptions}

### Delegation Guidelines:
1. **Choose the Best Expert**: Analyze the user's request and select the agent whose description most closely matches the required expertise.
2. **Task Description**: When delegating, provide a clear and detailed task description. Include any context the agent might need to succeed.
3. **No "I Can't"**: If an agent is available that can handle a request, do not tell the user you cannot do it. Simply delegate.
4. **Summary**: Once an agent returns a result, summarize the findings or actions for the user.

Example: If the user asks to "check the weather", and you see a 'browser' agent, delegate the task to it.`;
      },
      completionEventType: "manager:completion",
      toolDefinitions: {
        ...brainToolDefinitions,
        delegateTask: {
          description: `Delegate a specialized task to another agent. Use this whenever a task matches the capabilities of one of the available agents.`,
          inputSchema: z.object({
            agent: z.enum(agentNames).describe("The specialized agent to use"),
            task: z.string().describe("The detailed task description for the agent"),
          }),
        },
      },
    })
  );

  // 4. Generic delegation handler — works for any registered agent
  app.on("action:delegateTask", async function* (event: any, { state }) {
    const { agent, task, toolCallId } = event.data;
    const s = state as ChatState;

    if (!s.pendingAgentTasks) s.pendingAgentTasks = {};
    s.pendingAgentTasks[agent] = { toolCallId };

    yield {
      type: `agent:${agent}:input`,
      data: { content: task },
    };
  });

  // 5. Generic bridge-back handlers — auto-wired for every registered agent
  for (const agent of allAgents) {
    app.on(`agent:${agent.name}:output` as any, async function* (event: any, { state }) {
      const s = state as ChatState;
      const pending = s.pendingAgentTasks?.[agent.name];

      if (pending) {
        delete s.pendingAgentTasks![agent.name];

        yield {
          type: "action:taskResult",
          data: {
            action: "delegateTask",
            toolCallId: pending.toolCallId,
            result: event.data.content,
          },
        };
      }
    });
  }

  // 6. Init handlers
  app
    .on("init", initHandler)
    .on("sessionChange", sessionChangeHandler)
    .on("tabChange", tabChangeHandler)
    .on("action:updateSettings", updateSettingsHandler)
    .on("action:openAgentFolder", openAgentFolderHandler);

  return app;
}
