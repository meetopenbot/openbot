import { MelonyPlugin, Event } from "melony";
import { ui } from "@melony/ui-kit/server";

// --- Event types ---

export interface BrainStatusEvent extends Event {
  type: "brain:status";
  data: { message: string; severity?: "info" | "success" | "error" };
}

// --- UI Plugin ---

export const brainUIPlugin = (): MelonyPlugin<any, any> => (builder) => {
  builder.on(
    "brain:status" as any,
    async function* (event: BrainStatusEvent) {
      yield ui.event(ui.status(event.data.message, event.data.severity));
    }
  );
};
