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
  const { cwd = process.cwd(), env = process.env, maxOutputLength = 10000 } = options;

  builder.on("action:executeCommand", async function* (event, { state }) {
    const { command, toolCallId } = event.data;
    const currentCwd = state.cwd || cwd;

    yield {
      type: "shell:status",
      data: { message: `Executing command: ${command} in ${currentCwd}` }
    } as ShellStatusEvent;

    // Basic 'cd' detection and state update
    if (command.trim().startsWith("cd ")) {
      const targetDir = command.trim().slice(3).trim();
      const newCwd = path.resolve(currentCwd, targetDir);
      state.cwd = newCwd;
      
      yield {
        type: "shell:status",
        data: { message: `Directory changed to ${newCwd}`, severity: "success" }
      } as ShellStatusEvent;

      yield {
        type: "action:taskResult",
        data: {
          action: "executeCommand",
          toolCallId,
          result: {
            stdout: `Changed directory to ${newCwd}`,
            stderr: "",
            success: true
          },
        },
      };
      return;
    }

    try {
      const { stdout, stderr } = await execAsync(command, { cwd: currentCwd, env });

      yield {
        type: "shell:status",
        data: { message: `Command executed successfully`, severity: "success" }
      } as ShellStatusEvent;

      yield {
        type: "action:taskResult",
        data: {
          action: "executeCommand",
          toolCallId,
          result: {
            stdout: truncate(stdout, maxOutputLength),
            stderr: truncate(stderr, maxOutputLength),
            success: true
          },
        },
      };
    } catch (error: any) {
      yield {
        type: "action:taskResult",
        data: {
          action: "executeCommand",
          toolCallId,
          result: {
            error: error.message,
            stdout: truncate(error.stdout, maxOutputLength),
            stderr: truncate(error.stderr, maxOutputLength),
            success: false,
          },
        },
      };

      yield {
        type: "shell:status",
        data: { message: `Command failed: ${error.message}`, severity: "error" }
      } as ShellStatusEvent;
    }
  });

  builder.on("shell:status" as any, async function* (event: ShellStatusEvent) {
    yield ui.event(
      statusWidget(event.data.message, event.data.severity)
    );
  });
};
