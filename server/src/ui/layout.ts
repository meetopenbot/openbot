import { ui } from "@melony/ui-kit";
import { threadUI } from "./thread.js";
import { sidebarUI } from "./sidebar.js";
import { settingsUI } from "./settings.js";
import { skillsUI } from "./skills.js";
import { listSessions } from "../session.js";

const tabs = {
  chat: threadUI,
  settings: settingsUI,
  skills: skillsUI,
};

export const layoutUI = async ({ tab, sessionId }: { tab: string; sessionId?: string }) => {
  const sessions = await listSessions();

  return ui.row({ height: "full" }, [
    sidebarUI({ sessions, sessionId }),
    tabs[tab as keyof typeof tabs]
  ]);
};

export const sidebarOnlyUI = async ({ sessionId }: { sessionId?: string }) => {
  const sessions = await listSessions();

  return sidebarUI({ sessions, sessionId });
};

export const tabOnlyUI = async ({ tab }: { tab: string }) => {
  return tabs[tab as keyof typeof tabs];
};
