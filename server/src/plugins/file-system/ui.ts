import { MelonyPlugin, Event } from "melony";
import { ui } from "@melony/ui-kit/server";

export interface FileSystemStatusEvent extends Event {
  type: "file-system:status";
  data: { message: string; severity?: "info" | "success" | "error" };
}

export const fileSystemUIPlugin = (): MelonyPlugin<any, any> => (builder) => {
  builder.on("file-system:status" as any, async function* (event: FileSystemStatusEvent) {
    yield ui.event(
      ui.status(event.data.message, event.data.severity)
    );
  });
};
