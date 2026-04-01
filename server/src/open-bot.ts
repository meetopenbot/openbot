import { melony, Runtime } from "melony";
import { loadConfig, resolvePath, DEFAULT_BASE_DIR } from "./config.js";
import { createModel, parseModelString } from "./models.js";
import { DEFAULT_MODEL_ID } from "./model-defaults.js";
import { ConversationEvent, ConversationState } from "./types.js";
import { setupPluginRegistry } from "./core/plugins.js";
import { orchestrationToolsPlugin } from "./core/orchestrator.js";
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

  // 1. Setup unified registry (built-in tools + agents + community plugins)
  const registry = await setupPluginRegistry(resolvedBaseDir, model as any, resolvedModelId, options);

  // 2. Initialize agent runtimes
  const agentRuntimes = new Map<string, Runtime<ConversationState, ConversationEvent>>();

  for (const agent of registry.getAgents()) {
    const builder = melony<ConversationState, ConversationEvent>();
    
    // Apply the base agent plugin
    if (agent.plugin) {
      builder.use(agent.plugin);
    }

    // Always apply orchestration tools so any agent can delegate if it has the tools in its prompt
    builder.use(orchestrationToolsPlugin({ agentRuntimes }));
    
    agentRuntimes.set(agent.id, builder.build());
  }

  // 3. Trigger initialization for all runtimes
  const initPromises: Promise<void>[] = [];
  const exhaust = async (runtime: Runtime<ConversationState, ConversationEvent>, agentId: string) => {
    const iterator = runtime.run({ type: "init" } as any, { 
      runId: "init", 
      state: {} as any,
      agentId 
    } as any);
    for await (const _ of iterator) { /* side-effects only */ }
  };

  for (const [agentId, agentRuntime] of agentRuntimes.entries()) {
    initPromises.push(exhaust(agentRuntime, agentId));
  }

  await Promise.all(initPromises);

  // 4. Return the runtime
  return {
    registry,
    run: (event: ConversationEvent, context: { runId: string; state: ConversationState }) =>
      runOpenBot(event, context, agentRuntimes, registry),
  };
}
