import { InitEvent, ChatState, ChatEvent } from "../types.js";
import { sidebarOnlyUI, tabOnlyUI } from "../ui/layout.js";
import { RuntimeContext } from "melony";

/**
 * Initial application layout handler
 */
export async function* initHandler(
  event: InitEvent,
  { state }: RuntimeContext<ChatState, ChatEvent>
): AsyncGenerator<ChatEvent, void, unknown> {
  // Initialize path state if not already present
  if (!state.cwd) {
    state.cwd = process.cwd();
  }

  if (!state.workspaceRoot) {
    state.workspaceRoot = process.cwd();
  }

  const tab = event.data?.tab || "chat";

  // For init, return both sidebar and content
  yield {
    type: "ui",
    meta: {
      type: "sidebar",
    },
    data: await sidebarOnlyUI({ sessionId: state.sessionId })
  } as unknown as ChatEvent;

  yield {
    type: "ui",
    meta: {
      type: "content",
    },
    data: await tabOnlyUI({ tab })
  } as unknown as ChatEvent;
}

