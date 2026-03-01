import { Runtime } from "melony";
import { ChatEvent, ChatState } from "../types.js";

export async function* runOpenBot(
  event: ChatEvent,
  context: { runId: string; state: ChatState },
  managerRuntime: Runtime<ChatState, ChatEvent>,
  agentRuntimes: Map<string, Runtime<ChatState, ChatEvent>>
) {
  const { state } = context;

  // Initialize state
  if (!state.messages) state.messages = [];
  if (!state.agentStates) state.agentStates = {};

  // 1. Direct agent routing (e.g. "@os list files")
  if (event.type === "agent:input") {
    const content = (event.data as any).content as string;
    if (content?.startsWith("@")) {
      const match = content.match(/^@([a-zA-Z0-9_-]+)\s*(.*)$/);
      if (match) {
        const [, agentName, remaining] = match;
        const runtime = agentRuntimes.get(agentName);

        if (runtime) {
          if (!state.agentStates[agentName]) state.agentStates[agentName] = {};

          const agentEvent = {
            ...event,
            data: {
              content: remaining || "Hello",
              attachments: (event.data as any).attachments,
            },
          } as any;

          yield* runtime.run(agentEvent, {
            runId: context.runId,
            state: state.agentStates[agentName] as any,
          });
          return;
        }
      }
    }
  }

  // 2. Default routing: translate user event to manager input
  yield* managerRuntime.run({ ...event, type: "agent:input" } as ChatEvent, {
    runId: context.runId,
    state: state as any,
  });
}
