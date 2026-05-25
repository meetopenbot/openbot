import { Plugin } from '../../services/plugins/types.js';
import { OpenBotEvent } from '../../app/types.js';

/**
 * `naming` — injects a hint into the context if the thread needs a smart name.
 */
export const namingPlugin: Plugin = {
  id: 'naming',
  name: 'Thread Naming',
  description: 'Injects hints to help agents generate smart thread names.',
  factory: () => (builder) => {
    builder.on('agent:invoke', async function* (event, context) {
      const threadState = context.state.threadDetails?.state as any;
      
      // If the thread hasn't been "smart named" yet, inject a hint.
      if (!threadState?.isSmartNamed) {
        yield {
          type: 'agent:hint',
          data: { 
            content: 'SYSTEM HINT: This thread is unnamed. Please use the `patch_thread_details` tool to set a concise, descriptive, and regular `name` (e.g., "Project Brainstorming" instead of "project-brainstorm") in the thread state and set `isSmartNamed: true` in the same patch. Only do this once.' 
          },
          meta: { agentId: context.state.agentId }
        } as OpenBotEvent;
      }
    });
  },
};

export default namingPlugin;
