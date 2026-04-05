import { z } from 'zod';
import { MelonyBuilder, RuntimeContext } from 'melony';
import { ConversationEvent, ConversationState } from '../app/types.js';
import {
  memoryPlugin,
  memoryToolDefinitions,
  createMemoryPromptBuilder,
} from './memory.js';
import {
  mentionPlugin,
  mentionToolDefinitions,
} from './mention.js';
import { topicAgent } from '../agents/topic-agent.js';
import { llmPlugin } from './llm.js';
import { PluginRegistry } from '../registry/plugin-registry.js';
import { uiEvent } from '../ui/block.js';
import { widgets } from '../ui/registry.js';

/**
 * Tool definitions for orchestration.
 */
export const orchestratorToolDefinitions = {
  ...memoryToolDefinitions,
  ...mentionToolDefinitions,
  updateSessionState: {
    description: 'Update a value in the session state using a JSON path.',
    inputSchema: z.object({
      path: z.string().describe("The JSON path to the value (e.g. 'project_plan.todos.0.status')"),
      value: z.any().describe('The new value to set'),
    }),
  },
};

/**
 * Simple helper to set a value in an object by a dot-separated path.
 */
function setByPath(obj: any, path: string, value: any) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Helper to emit a UI snapshot for a widget if applicable.
 */
function* maybeEmitWidget(key: string, value: any) {
  if (!value || typeof value !== 'object') return;

  let widgetName = value.widget;
  let data = value;

  if (!widgetName && Array.isArray(value.todos)) {
    widgetName = 'todoList';
    data = value.todos;
  }

  if (!widgetName && Array.isArray(value) && ['todos', 'todoList', 'project_plan'].includes(key)) {
    widgetName = 'todoList';
    data = value;
  }

  if (widgetName && (widgets as any)[widgetName] && Array.isArray(data)) {
    const isTodo = widgetName === 'todoList';
    yield uiEvent(
      (widgets as any)[widgetName](data, {
        placement: isTodo ? 'attention' : 'sidebar',
        id: isTodo ? `attention-${key}` : `sidebar-${key}`,
        meta: {
          title:
            key === 'project_plan'
              ? 'Project Plan'
              : key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
        },
      }),
    ) as any;
  }
}

/**
 * Orchestration Tools Plugin — session state updates and related actions.
 */
export function orchestrationToolsPlugin() {
  return (builder: MelonyBuilder<ConversationState, ConversationEvent>) => {
    builder.use(mentionPlugin());
    builder.on(
      'action:updateSessionState',
      async function* (
        event: ConversationEvent,
        context: { runId: string; state: ConversationState },
      ) {
        const { path, value, toolCallId } = event.data;
        const state = context.state as any;

        try {
          setByPath(state, path, value);
          const topLevelKey = path.split('.')[0];
          yield* maybeEmitWidget(topLevelKey, state[topLevelKey]);

          yield {
            type: 'action:result',
            data: {
              action: 'updateSessionState',
              result: `Successfully updated state at path "${path}".`,
              toolCallId,
            },
          } as ConversationEvent;
        } catch (error: any) {
          yield {
            type: 'action:result',
            data: {
              action: 'updateSessionState',
              result: `Error updating state: ${error.message}`,
              toolCallId,
            },
          } as ConversationEvent;
        }
      },
    );
  };
}

/**
 * Creates the dynamic system prompt for an orchestrator agent.
 */
export function createOrchestratorPromptBuilder(options: {
  resolvedBaseDir: string;
  registry: PluginRegistry;
}) {
  const { resolvedBaseDir, registry } = options;
  const buildMemoryPrompt = createMemoryPromptBuilder(resolvedBaseDir);
  const allAgents = registry.getAgents();

  const getAgentDescriptions = (excludeId?: string) => {
    return allAgents
      .filter((a) => a.id !== excludeId)
      .map((a) => {
        const tools = a.capabilities
          ? Object.entries(a.capabilities)
              .map(([name, desc]) => `    - ${name}: ${desc}`)
              .join('\n')
          : '';
        return `<agent id="${a.id}" name="${a.name}">
  <description>${a.description}</description>
${tools ? `  <capabilities>\n${tools}\n  </capabilities>` : ''}
</agent>`;
      })
      .join('\n\n');
  };

  return async (context: RuntimeContext, baseInstructions: string = '') => {
    const memoryPrompt = await buildMemoryPrompt(context);
    const state = context.state as ConversationState;
    const currentAgentId = (context as any).agentId;

    const agentDescriptions = getAgentDescriptions(currentAgentId);
    const standardKeys = [
      'messages',
      'agentStates',
      'usage',
      'cwd',
      'workspaceRoot',
      'title',
      'conversationId',
      'threadAssignees',
    ];
    const customState: Record<string, any> = {};
    for (const key of Object.keys(state)) {
      if (!standardKeys.includes(key)) customState[key] = state[key];
    }

    const statePrompt =
      Object.keys(customState).length > 0
        ? `\n\n<session_state>\n${JSON.stringify(customState, null, 2)}\n</session_state>`
        : '';

    return `
${baseInstructions}

<expert_mode>
You are interacting directly with the user. Focus on solving their request directly using your tools.
Other specialized agents exist in this workspace; you can collaborate with them by using the "mention" tool. This allows you to ask them a question or give them a task in the same thread.
When the user asks for multiple delegated steps (e.g. one agent gathers facts, another summarizes), do them strictly in order: one mention call, wait for its tool result, then the next mention if needed—never issue two mention tool calls in the same model step. After the final tool result, reply with the combined outcome.
</expert_mode>
${statePrompt}

<agents>
${agentDescriptions}
</agents>${memoryPrompt}`;
  };
}

/**
 * Helper to wrap llmPlugin with orchestration.
 */
export function llmOrchestratorPlugin(options: {
  model: any;
  resolvedModelId: string;
  resolvedBaseDir: string;
  registry: PluginRegistry;
  system: string | ((context: RuntimeContext) => string | Promise<string>);
  toolDefinitions?: Record<string, any>;
  outputSchema?: z.ZodType<any>;
}) {
  const {
    model,
    resolvedModelId,
    resolvedBaseDir,
    registry,
    system,
    toolDefinitions = {},
    outputSchema,
  } = options;
  const buildOrchestratorPrompt = createOrchestratorPromptBuilder({ resolvedBaseDir, registry });

  return (builder: MelonyBuilder<ConversationState, ConversationEvent>) => {
    builder
      .use(memoryPlugin({ baseDir: resolvedBaseDir }))
      .use(topicAgent({ model: model as any }))
      .use(
        llmPlugin({
          model: model as any,
          modelId: resolvedModelId,
          usageScope: 'manager',
          system: async (context: any) => {
            const baseInstructions = typeof system === 'function' ? await system(context) : system;
            const prompt = await buildOrchestratorPrompt(context, baseInstructions);
            return prompt;
          },
          toolDefinitions: {
            ...orchestratorToolDefinitions,
            ...toolDefinitions,
          },
          outputSchema,
        }),
      );
  };
}
