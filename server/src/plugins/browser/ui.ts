import { MelonyPlugin } from "melony";
import { ui } from "@melony/ui-kit/server";
import { BrowserStatusEvent, BrowserStateUpdateEvent } from "./index.js";

export const browserUIPlugin = (): MelonyPlugin<any, any> => (builder) => {
  builder.on("browser:status" as any, async function* (event: BrowserStatusEvent) {
    yield ui.event(
      ui.status(event.data.message, event.data.severity)
    );
  });

  builder.on("browser:state-update" as any, async function* (event: BrowserStateUpdateEvent) {
    if (event.data.screenshot) {
      yield ui.event(
        ui.resourceCard(event.data.title, event.data.url, [
          ui.image(`data:image/jpeg;base64,${event.data.screenshot}`),
        ])
      );
    }
  });
};
