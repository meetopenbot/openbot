import { MelonyPlugin, Event } from "melony";
import { ui } from "@melony/ui-kit/server";

export interface ShellStatusEvent extends Event {
  type: "shell:status";
  data: { message: string; severity?: "info" | "success" | "error" };
}

export const shellUIPlugin = (): MelonyPlugin<any, any> => (builder) => {
  builder.on("shell:status" as any, async function* (event: ShellStatusEvent) {
    yield ui.event(
      ui.status(event.data.message, event.data.severity)
    );
  });
};
