import { z } from 'zod';
import { generateId } from 'melony';
import type { Plugin } from '../../services/plugins/types.js';
import { runAgent } from '../../harness/index.js';
import {
  OpenBotEvent,
  DelegateTaskEvent,
} from '../../app/types.js';

/**
 * `delegation` — allows agents to delegate tasks to other agents.
 * 
 * Only the 'system' agent is allowed to delegate by default.
 * It uses runAgent to execute the delegated agent in its own isolated runtime,
 * bridging events back to the caller's stream.
 */

const delegationToolDefinitions = {
  delegate_task: {
    description: 'Delegate a specific task or question to another specialized agent.',
    inputSchema: z.object({
      agentId: z.string().describe('The ID of the agent to delegate to (e.g., "researcher", "coder").'),
      prompt: z.string().describe('The instructions or question for the delegated agent.'),
    }),
  },
};

export const delegationPlugin: Plugin = {
  id: 'delegation',
  name: 'Delegation',
  description: 'Allows agents to call upon other agents to solve sub-tasks.',
  toolDefinitions: delegationToolDefinitions,
  factory: () => (builder) => {

    // Handle the tool execution
    builder.on('action:delegate_task', async function* (event, context) {
      const delegateEvent = event as DelegateTaskEvent;

      // POLICY: Only the 'system' agent can delegate
      if (context.state.agentId !== 'system') {
        yield {
          type: 'action:delegate_task:result',
          data: {
            success: false,
            error: 'Only the system agent can delegate.'
          },
          meta: delegateEvent.meta,
        } as OpenBotEvent;
        return;
      }

      const { agentId, prompt } = delegateEvent.data;
      const toolCallId = delegateEvent.meta?.toolCallId;

      if (!toolCallId) return;

      const runId = `dg_${generateId()}`;
      let lastAgentOutput = '';

      // Queue to bridge the async onEvent callback to this generator
      const eventQueue: OpenBotEvent[] = [];
      let resolveNext: (() => void) | null = null;
      let isFinished = false;

      // Start the delegated agent in its own runtime.
      // We don't await this immediately so we can yield events as they arrive.
      const runPromise = runAgent({
        runId,
        agentId,
        event: {
          type: 'agent:invoke',
          data: {
            role: 'user',
            content: prompt,
            agentId: agentId,
          },
          meta: {
            threadId: context.state.threadId,
            parentAgentId: context.state.agentId,
            parentToolCallId: toolCallId,
          },
        } as OpenBotEvent,
        channelId: context.state.channelId,
        threadId: context.state.threadId,
        onEvent: async (outEvent) => {
          // Enrich events with parent metadata so the UI can track the hierarchy
          const enrichedEvent = {
            ...outEvent,
            meta: {
              ...outEvent.meta,
              parentAgentId: context.state.agentId,
              parentToolCallId: toolCallId,
            }
          };

          eventQueue.push(enrichedEvent);

          if (outEvent.type === 'agent:output') {
            lastAgentOutput = outEvent.data.content;
          }

          // Wake up the generator loop if it's waiting
          if (resolveNext) {
            resolveNext();
            resolveNext = null;
          }
        }
      }).catch(error => {
        console.error(`[delegation] Error in delegated run ${runId}:`, error);
      }).finally(() => {
        isFinished = true;
        if (resolveNext) {
          resolveNext();
          resolveNext = null;
        }
      });

      // Yield events from the delegated agent as they arrive
      while (!isFinished || eventQueue.length > 0) {
        if (eventQueue.length === 0) {
          await new Promise<void>(r => { resolveNext = r; });
        }
        while (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        }
      }

      // Ensure the run is fully complete (though isFinished already implies this)
      await runPromise;

      // Yield the result back to our own LLM runtime.
      yield {
        type: 'action:delegate_task:result',
        data: {
          success: true,
          output: lastAgentOutput,
        },
        meta: {
          ...delegateEvent.meta,
          agentId: context.state.agentId,
          toolCallId: toolCallId,
        },
      } as OpenBotEvent;
    });
  },
};

export default delegationPlugin;
