import { MelonyPlugin, Event } from "melony";
import { ui } from "@melony/ui-kit/server";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import { statusWidget } from "../../ui/widgets/status.js";

const execAsync = promisify(exec);

export const shellToolDefinitions = {
  executeCommand: {
    description: "Execute a shell command. Use 'cd' to change the current working directory for subsequent commands.",
    inputSchema: z.object({
      command: z.string().describe("The shell command to execute"),
    }),
  },
};

export interface ShellStatusEvent extends Event {
  type: "shell:status";
  data: { message: string; severity?: "info" | "success" | "error" };
}

export interface ShellPluginOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Maximum number of characters to keep in stdout/stderr.
   * If exceeded, the output will be truncated from the middle.
   * Default: 2000 (1000 from start, 1000 from end)
   */
  maxOutputLength?: number;
}

/**
 * Truncates a string by keeping the first and last N characters.
 */
function truncate(str: string | undefined | null, maxChars: number): string | undefined | null {
  if (!str || str.length <= maxChars) return str;
  const half = Math.floor(maxChars / 2);
  const truncatedCount = str.length - maxChars;
  return `${str.slice(0, half)}\n\n[... ${truncatedCount} characters truncated ...]\n\n${str.slice(-half)}`;
}

export const shellPlugin = (options: ShellPluginOptions = {}): MelonyPlugin<any, any> => (builder) => {
  builder.on("shell:status" as any, async function* (event: ShellStatusEvent) {
    yield ui.event(
      statusWidget(event.data.message, event.data.severity)
    );
  });
};
