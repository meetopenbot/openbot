import { ui } from "@melony/ui-kit";
import { threadUI } from "./thread.js";
import { sidebarUI } from "./sidebar.js";
import { settingsUI } from "./settings.js";
import { skillsUI } from "./skills.js";
import { listSessions } from "../session.js";

const tabs: Record<string, any> = {
  chat: threadUI,
  settings: settingsUI,
  skills: skillsUI,
};

export const layoutUI = async ({ tab, sessionId }: { tab: string; sessionId?: string }) => {
  const sessions = await listSessions();
  const content = typeof tabs[tab] === "function" ? await tabs[tab]() : tabs[tab];

  return ui.row({ height: "full" }, [
    sidebarUI({ sessions, sessionId }),
    content
  ]);
};

export const sidebarOnlyUI = async ({ sessionId }: { sessionId?: string }) => {
  const sessions = await listSessions();

  return sidebarUI({ sessions, sessionId });
};

export const tabOnlyUI = async ({ tab }: { tab: string }) => {
  return typeof tabs[tab] === "function" ? await tabs[tab]() : tabs[tab];
};
