import { melony, Runtime } from "melony";
import { loadConfig, resolvePath, DEFAULT_BASE_DIR } from "./config.js";
import { createModel, parseModelString } from "./models.js";
import { DEFAULT_MODEL_ID } from "./model-defaults.js";
import { ChatEvent, ChatState } from "./types.js";
import { setupPluginRegistry } from "./core/plugins.js";
import { setupAgentRegistry } from "./core/agents.js";
import { createManagerPlugin } from "./core/manager.js";
import { setupDelegation } from "./core/delegation.js";
import { runOpenBot } from "./core/router.js";

/**
 * Create the OpenBot runtime.
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

  // 1. Setup registries
  const pluginRegistry = await setupPluginRegistry(resolvedBaseDir);
  const agentRegistry = await setupAgentRegistry(resolvedBaseDir, pluginRegistry, model as any, options);

  // 2. Initialize agent runtimes
  const agentRuntimes = new Map<string, Runtime<ChatState, ChatEvent>>();
  for (const agent of agentRegistry.getAll()) {
    const builder = melony<ChatState, ChatEvent>();
    builder.use(agent.plugin);
    agentRuntimes.set(agent.name, builder.build());
  }

  // 3. Initialize manager runtime
  const managerBuilder = melony<ChatState, ChatEvent>();
  managerBuilder.use(createManagerPlugin(model, resolvedModelId, resolvedBaseDir, agentRegistry));
  
  // 4. Setup delegation
  setupDelegation(managerBuilder, agentRuntimes);
  
  const managerRuntime = managerBuilder.build();

  // 5. Return the runtime
  return {
    run: (event: ChatEvent, context: { runId: string; state: ChatState }) =>
      runOpenBot(event, context, managerRuntime, agentRuntimes),
  };
}
