import { SessionChangeEvent, ChatState, ChatEvent } from "../types.js";
import { sidebarOnlyUI, tabOnlyUI } from "../ui/layout.js";
import { RuntimeContext } from "melony";

/**
 * Session change handler
 */
export async function* sessionChangeHandler(
  event: SessionChangeEvent,
  { state }: RuntimeContext<ChatState, ChatEvent>
): AsyncGenerator<ChatEvent, void, unknown> {
  const tab = event.data?.tab || "chat";

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
