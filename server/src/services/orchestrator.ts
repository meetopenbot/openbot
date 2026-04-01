import { z } from 'zod';
import { MelonyBuilder, Runtime, generateId, RuntimeContext } from 'melony';
import { ConversationEvent, ConversationState } from '../app/types.js';
import {
  memoryPlugin,
  memoryToolDefinitions,
  createMemoryPromptBuilder,
} from '../plugins/memory.js';
import { topicAgent } from '../agents/topic-agent.js';
import { llmPlugin } from '../plugins/llm.js';
import { PluginRegistry } from '../registry/plugin-registry.js';
import { uiEvent } from '../ui/block.js';
import { widgets } from '../ui/registry.js';

/**
 * Tool definitions for orchestration.
 */
export const orchestratorToolDefinitions = {
  ...memoryToolDefinitions,
  delegateTask: {
    description: `Delegate a task to a specialized expert agent by creating a dedicated Thread.`,
    inputSchema: z.object({
      agentId: z.string().describe('The ID of the agent to use'),
      task: z.string().describe('The task for the agent to perform'),
      threadTitle: z
        .string()
        .optional()
        .describe("A short title for the new thread (e.g. 'Fix Router Bug')"),
      stateKey: z
        .string()
        .optional()
        .describe('Optional key to store structured JSON result in the session state'),
      attachments: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            mimeType: z.string(),
            size: z.number(),
            url: z.string(),
          }),
        )
        .optional()
        .describe('Attachments to pass through to the agent'),
    }),
  },
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
 * Orchestration Tools Plugin.
 *
 * Only provides the action handlers for delegation and state management.
 */
export function orchestrationToolsPlugin(options: {
  agentRuntimes: Map<string, Runtime<ConversationState, ConversationEvent>>;
}) {
  const { agentRuntimes } = options;

  return (builder: MelonyBuilder<ConversationState, ConversationEvent>) => {
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

    builder.on(
      'action:delegateTask',
      async function* (
        event: ConversationEvent,
        context: { runId: string; state: ConversationState },
      ) {
        const { agentId, toolCallId, task, stateKey, attachments, threadTitle } = event.data;
        const agentRuntime = agentRuntimes.get(agentId);
        const delegatorAgentId = (context as any).agentId;

        if (!agentRuntime) {
          yield {
            type: 'action:result',
            data: {
              action: 'delegateTask',
              result: `Error: Agent "${agentId}" not found.`,
              toolCallId,
            },
          };
          return;
        }

        const delegationId = `del_${generateId()}`;
        const state = context.state as ConversationState;

        state.threadAssignees ??= {};
        state.threadAssignees[delegationId] = agentId;

        yield {
          type: 'delegation:start',
          meta: { delegationId, agentName: agentId, threadId: delegationId },
          data: { agent: agentId, task, title: threadTitle || task.slice(0, 50) + '...' },
        } as ConversationEvent;

        if (!state.agentStates) state.agentStates = {};
        if (!state.agentStates[agentId]) state.agentStates[agentId] = {};
        const agentState = state.agentStates[agentId];

        const agentIterator = agentRuntime.run(
          {
            type: 'agent:input',
            data: { content: task, attachments },
            meta: { threadId: delegationId },
          } as any,
          { runId: delegationId, state: agentState as any, agentId } as any,
        );

        let lastAgentOutput = '';
        let pendingApprovalId: string | undefined;

        try {
          for await (const agentEvent of agentIterator) {
            if (agentEvent.type === 'suspend') {
              const suspendData = (agentEvent as any).data ?? {};
              const suspendId = typeof suspendData.id === 'string' ? suspendData.id : undefined;
              if (suspendId) pendingApprovalId = suspendId;
              yield {
                ...agentEvent,
                meta: {
                  ...agentEvent.meta,
                  delegationId,
                  agentName: agentId,
                  threadId: delegationId,
                },
              } as ConversationEvent;
              continue;
            }

            if (agentEvent.type === 'agent:input') {
              yield {
                ...agentEvent,
                type: 'agent:sub-input',
                meta: {
                  ...agentEvent.meta,
                  delegationId,
                  agentName: agentId,
                  threadId: delegationId,
                },
              } as ConversationEvent;
              continue;
            }

            if (agentEvent.type.startsWith('action:') && agentEvent.type !== 'action:result') {
              yield {
                ...agentEvent,
                type: 'agent:sub-action',
                meta: {
                  ...agentEvent.meta,
                  delegationId,
                  agentName: agentId,
                  threadId: delegationId,
                },
                data: { ...agentEvent.data, originalType: agentEvent.type },
              } as ConversationEvent;
              continue;
            }

            if (agentEvent.type === 'action:result') {
              yield {
                ...agentEvent,
                type: 'agent:sub-action-result',
                meta: {
                  ...agentEvent.meta,
                  delegationId,
                  agentName: agentId,
                  threadId: delegationId,
                },
              } as ConversationEvent;
              continue;
            }

            if (agentEvent.type === 'usage:update') {
              yield {
                ...agentEvent,
                type: 'agent:sub-usage',
                meta: {
                  ...agentEvent.meta,
                  delegationId,
                  agentName: agentId,
                  threadId: delegationId,
                },
              } as ConversationEvent;
              continue;
            }

            yield {
              ...agentEvent,
              meta: {
                ...agentEvent.meta,
                delegationId,
                agentName: agentId,
                threadId: delegationId,
              },
            } as ConversationEvent;

            if (agentEvent.type === 'agent:output') {
              const agentOutput = agentEvent.data as any;
              const value =
                agentOutput?.result ?? agentOutput?.content ?? agentOutput?.message ?? agentOutput;
              if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                if (stateKey) {
                  state[stateKey] = value;
                  yield* maybeEmitWidget(stateKey, value);
                }
                if (lastAgentOutput) lastAgentOutput += '\n\n';
                lastAgentOutput += JSON.stringify(value, null, 2);
              } else if (typeof value === 'string') {
                if (lastAgentOutput) lastAgentOutput += '\n\n';
                lastAgentOutput += value;
              }
            }
          }
        } catch (error: any) {
          console.error(`[orchestrator] Error running agent "${agentId}":`, error);
          lastAgentOutput = `Error executing task: ${error.message}`;
        }

        if (pendingApprovalId) {
          state.pendingAgentTasks ??= {};
          state.pendingAgentTasks[pendingApprovalId] = {
            toolCallId,
            agentName: agentId,
            delegatorAgentId,
            delegationId,
            stateKey: typeof stateKey === 'string' ? stateKey : undefined,
          };
          return;
        }

        yield {
          type: 'delegation:end',
          meta: { delegationId, agentName: agentId, threadId: delegationId },
          data: { agent: agentId, result: lastAgentOutput || 'Task completed.' },
        } as ConversationEvent;

        yield {
          type: 'action:result',
          data: {
            action: 'delegateTask',
            result: lastAgentOutput || 'Task completed with no output.',
            toolCallId,
          },
        } as ConversationEvent;
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

  const getAgentDescriptions = (memberIds?: string[], excludeId?: string) => {
    return allAgents
      .filter((a) => (!memberIds || memberIds.includes(a.id)) && a.id !== excludeId)
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
    const managerId = state.channelManagerId || 'you';
    const isChannel = !!state.conversationId?.startsWith('channel_');
    const members = state.channelMembers as Array<{ id: string; name: string }> | undefined;
    const memberIds = members?.map((m) => m.id);
    const currentAgentId = (context as any).agentId;
    const isActingAsManager = isChannel && managerId === currentAgentId;

    let orchestratorPrompt = '';

    if (isActingAsManager) {
      orchestratorPrompt = `
<orchestrator_mode>
You are the **Lead Orchestrator** of this channel.
You have a team of member agents available to you. 

**Directives**:
1. **Lead**: Take ownership of the conversation. Ensure the user's goal is met.
2. **Assign**: Use \`delegateTask\` to spin up a new **Thread** for specialized tasks.
3. **Review**: You are the primary point of contact. Review and summarize findings from thread assignees for the user.
</orchestrator_mode>

<principles>
1. **Channels**: As a manager, triage incoming requests. Decide if you should handle them or delegate.
2. **Threads**: Treat every complex task as a separate **Thread**. Use \`delegateTask\` to assign a thread to an expert.
3. **Synthesis**: Once an expert finishes their thread, summarize the outcome for the user in the main channel.
</principles>`;
    } else if (!isChannel || managerId === 'you') {
      orchestratorPrompt = `
<expert_mode>
You are interacting directly with the user. Focus on solving their request directly using your tools.
If the task is complex, you can still use \`delegateTask\` to get help from other agents.
</expert_mode>`;
    }

    const agentDescriptions = getAgentDescriptions(memberIds, currentAgentId);
    const standardKeys = [
      'messages',
      'agentStates',
      'usage',
      'cwd',
      'workspaceRoot',
      'title',
      'conversationId',
      'pendingAgentTasks',
      'channelMembers',
      'channelManagerId',
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

    const channelContext =
      isChannel && members
        ? `\n\n<channel_context>
This is a shared channel. 
Members: ${members.map((m) => `${m.name} (@${m.id})`).join(', ')}
Manager: ${managerId === 'you' ? 'The User' : managerId}
${(state.messages?.length || 0) <= 1 && isActingAsManager ? '\n**Important**: This is the very first message in this channel. As the manager, you should analyze the request and decide if you should handle it or delegate parts of it to your team members immediately.' : ''}
</channel_context>`
        : '';

    return `
${baseInstructions}

${orchestratorPrompt}
${statePrompt}
${channelContext}

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
            return buildOrchestratorPrompt(context, baseInstructions);
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
