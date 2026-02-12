import { MelonyPlugin, Event } from "melony";
import { ui } from "@melony/ui-kit/server";

// --- Event types ---

export interface SkillsStatusEvent extends Event {
  type: "skills:status";
  data: { message: string; severity?: "info" | "success" | "error" };
}

export interface SkillsLoadedEvent extends Event {
  type: "skills:loaded";
  data: { skillId: string; title: string; instructions: string };
}

// --- UI Plugin ---

export const skillsUIPlugin = (): MelonyPlugin<any, any> => (builder) => {
  builder.on(
    "skills:status" as any,
    async function* (event: SkillsStatusEvent) {
      yield ui.event(ui.status(event.data.message, event.data.severity));
    }
  );

  builder.on(
    "skills:loaded" as any,
    async function* (event: SkillsLoadedEvent) {
      yield ui.event(
        ui.resourceCard(event.data.title, "", [
          ui.text(event.data.instructions),
        ])
      );
    }
  );
};
