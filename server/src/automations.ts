import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_BASE_DIR, loadConfig, resolvePath } from "./config.js";

export interface AutomationRecord {
  id: string;
  name: string;
  prompt: string;
  cron: string;
  targetType: "orchestrator" | "agent";
  agentName?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

function getAutomationsPath(): string {
  const cfg = loadConfig();
  const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
  const resolvedBaseDir = resolvePath(baseDir);
  return path.join(resolvedBaseDir, "automations.json");
}

export async function listAutomations(): Promise<AutomationRecord[]> {
  const filePath = getAutomationsPath();
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const targetType: AutomationRecord["targetType"] =
          item.targetType === "agent" ? "agent" : "orchestrator";
        const agentName =
          typeof item.agentName === "string" && item.agentName.trim()
            ? item.agentName.trim()
            : undefined;

        return {
          id: typeof item.id === "string" ? item.id : "",
          name: typeof item.name === "string" ? item.name : "",
          prompt: typeof item.prompt === "string" ? item.prompt : "",
          cron: typeof item.cron === "string" ? item.cron : "",
          targetType,
          agentName: targetType === "agent" ? agentName : undefined,
          enabled: Boolean(item.enabled),
          createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
          updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
        };
      })
      .filter((item) => {
        if (!item.id || !item.name || !item.prompt || !item.cron) return false;
        if (item.targetType === "agent" && !item.agentName) return false;
        return true;
      });
  } catch {
    return [];
  }
}

export async function saveAutomations(items: AutomationRecord[]): Promise<void> {
  const filePath = getAutomationsPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(items, null, 2), "utf-8");
}
