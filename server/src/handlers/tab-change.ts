import { TabChangeEvent, ChatState, ChatEvent } from "../types.js";
import { tabOnlyUI } from "../ui/layout.js";
import { RuntimeContext } from "melony";

/**
 * Tab change handler
 */
export async function* tabChangeHandler(
  event: TabChangeEvent,
  { state }: RuntimeContext<ChatState, ChatEvent>
): AsyncGenerator<ChatEvent, void, unknown> {
  const tab = event.data?.tab || "chat";

  yield {
    type: "ui",
    meta: {
      type: "content",
    },
    data: await tabOnlyUI({ tab })
  } as unknown as ChatEvent;
}
