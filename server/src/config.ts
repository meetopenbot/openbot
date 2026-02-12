import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface MelonyConfig {
  model?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  baseDir?: string;
  port?: number;
}

export const DEFAULT_BASE_DIR = "~/.openbot";

export function loadConfig(): MelonyConfig {
  const configPath = path.join(os.homedir(), ".openbot", "config.json");
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (error) {
      console.error(`Warning: Failed to parse config at ${configPath}`, error);
    }
  }
  return {};
}

export function saveConfig(config: Partial<MelonyConfig>) {
  const configDir = path.join(os.homedir(), ".openbot");
  const configPath = path.join(configDir, "config.json");

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  const currentConfig = loadConfig();
  const newConfig = { ...currentConfig, ...config };

  fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), { mode: 0o600 });
}

export function resolvePath(p: string) {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : path.resolve(p);
}
