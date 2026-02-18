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
import { approvalPlugin } from "./plugins/approval/index.js";

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

  pluginRegistry.register({
    name: "approval",
    description: "Require user approval for specific actions",
    toolDefinitions: {},
    factory: (options) => approvalPlugin(options),
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

  // 2.5 Command Prefix Router
  // Allows bypassing the manager using "/agent task" (e.g. "/os list files")
  app.on("user:text", async function* (event, { state }) {
    const content = event.data.content.trim();
    if (content.startsWith("/")) {
      const firstSpace = content.indexOf(" ");
      const prefix = firstSpace === -1 ? content.slice(1) : content.slice(1, firstSpace);
      const task = firstSpace === -1 ? "" : content.slice(firstSpace + 1).trim();

      if (agentNames.includes(prefix as any)) {
        // Direct route to specialized agent
        state.lastDirectAgent = prefix;
        yield {
          type: `agent:${prefix}:input`,
          data: { content: task },
        } as ChatEvent;
        return;
      }
    }

    // Default: send to manager for reasoning/delegation
    state.lastDirectAgent = undefined;
    yield { type: "manager:input", data: event.data } as ChatEvent;
  });

  // 2.6 Global Tool Result Dispatcher
  // Routes tool results to the appropriate agent's internal loop.
  // taskResult means that the loop is complete.
  app.on("action:taskResult", async function* (event, { state, suspend }) {
    const s = state as ChatState;

    // 1. Direct route (prefix command)
    if (s.lastDirectAgent) {
      // suspend not to go to infinite loop
      // suspend({
      //   type: `agent:${s.lastDirectAgent}:result`,
      //   data: event.data,
      // } as ChatEvent);

      yield {
        type: `agent:${s.lastDirectAgent}:result`,
        data: event.data,
      } as ChatEvent;
    }

    // 2. Delegation route (manager-led)
    // Find which agent has a pending task
    const pendingAgentName = Object.keys(s.pendingAgentTasks || {}).find(
      (name) => s.pendingAgentTasks![name]
    );

    if (pendingAgentName) {
      yield {
        type: `agent:${pendingAgentName}:result`,
        data: event.data,
      } as ChatEvent;
      return;
    }

    // 3. Manager route (brain tools, etc.)
    yield {
      type: "manager:result",
      data: event.data,
    } as ChatEvent;
  });

  app.use(
    llmPlugin({
      model: model as any,
      system: async (context) => {
        const [brainPrompt] = await Promise.all([
          buildBrainPrompt(context),
        ]);

        return `${brainPrompt}

## Core Role: Manager Agent
You are the **Manager Agent**. You have exactly two jobs:
1. **Task Delegation**: Orchestrate tasks by delegating them to specialized agents.
2. **Memory & Identity**: Manage your long-term memory and identity using your core brain tools (\`remember\`, \`recall\`, \`updateIdentity\`, etc.).

### Delegation & Reporting Guidelines:
- **Delegate by Default**: If a task requires capabilities outside of memory/identity management (like shell access, file operations, web browsing), you **MUST** delegate to the appropriate agent.
- **Be Concise**: When a sub-agent completes a task, provide a **nice, concise summary**. Sub-agents provide detailed outputs in the background; your response should be a brief, high-level answer to the user. Do not repeat details unless necessary.
- **Detailed Delegation**: When calling \`delegateTask\`, provide a thorough description of the task so the sub-agent has full context.

### Available Agents:
${agentDescriptions}

Remember: You are the orchestrator. Let the specialized agents do the work, and you provide the concise final answer.`;
      },
      promptInputType: "manager:input",
      actionResultInputType: "manager:result",
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
        // This was a delegated task — bridge back to the manager's tool call
        delete s.pendingAgentTasks![agent.name];

        yield {
          type: "manager:result",
          data: {
            action: "delegateTask",
            toolCallId: pending.toolCallId,
            result: event.data.content,
          },
        } as ChatEvent;
      } else {
        // This was a direct command (prefix) — show output directly as assistant text
        yield {
          type: "assistant:text",
          data: { content: event.data.content },
          meta: { agent: agent.name }
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
