import { MelonyPlugin, Event } from "melony";
import { uiEvent } from "../../ui/block.js";
import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { statusWidget } from "../../ui/widgets/status.js";

export const fileSystemToolDefinitions = {
  readFile: {
    description: "Read the contents of a file. Path can be absolute or relative to the current working directory.",
    inputSchema: z.object({
      path: z.string().describe("The path to the file (e.g., 'src/main.ts' or '/etc/hosts')"),
    }),
  },
  writeFile: {
    description: "Write content to a file. Path can be absolute or relative to the current working directory.",
    inputSchema: z.object({
      path: z.string().describe("The path to the file (e.g., 'new-file.ts')"),
      content: z.string().describe("The content to write to the file"),
    }),
  },
  listFiles: {
    description: "List files in a directory. Path can be absolute or relative to the current working directory.",
    inputSchema: z.object({
      path: z.string().describe("The path to the directory (use '.' for current directory)"),
    }),
  },
  deleteFile: {
    description: "Delete a file. Path can be absolute or relative to the current working directory.",
    inputSchema: z.object({
      path: z.string().describe("The path to the file"),
    }),
  },
};

export interface FileSystemStatusEvent extends Event {
  type: "file-system:status";
  data: { message: string; severity?: "info" | "success" | "error" };
}

export interface FileSystemPluginOptions {
  baseDir?: string;
  /**
   * Maximum number of characters to keep when reading a file.
   * If exceeded, the content will be truncated from the middle.
   * Default: 10000
   */
  maxFileReadLength?: number;
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

export const fileSystemPlugin = (options: FileSystemPluginOptions = {}): MelonyPlugin<any, any> => (builder) => {
  const { baseDir = "/", maxFileReadLength = 10000 } = options;

  const resolvePath = (p: string, stateCwd?: string) => {
    // If p is absolute, resolve from root. If relative, resolve from stateCwd or baseDir.
    const resolved = path.isAbsolute(p) ? p : path.resolve(stateCwd || baseDir, p);
    return resolved;
  };

  builder.on("action:readFile", async function* (event, { state }) {
    const { path: filePath, toolCallId } = event.data;

    yield {
      type: "file-system:status",
      data: { message: `Reading file: ${filePath} (relative to ${state.cwd || baseDir})` }
    } as FileSystemStatusEvent;

    try {
      const content = await fs.readFile(resolvePath(filePath, state.cwd), "utf-8");
      yield {
        type: "action:result",
        data: { 
          action: "readFile", 
          result: { content: truncate(content, maxFileReadLength) }, 
          toolCallId 
        },
      };
      yield {
        type: "file-system:status",
        data: { message: `File read successfully`, severity: "success" }
      } as FileSystemStatusEvent;
    } catch (error: any) {
      yield {
        type: "action:result",
        data: { action: "readFile", result: { error: error.message }, toolCallId },
      };
      yield {
        type: "file-system:status",
        data: { message: `File read failed: ${error.message}`, severity: "error" }
      } as FileSystemStatusEvent;
    }
  });

  builder.on("action:writeFile", async function* (event, { state }) {
    const { path: filePath, content, toolCallId } = event.data;
    yield {
      type: "file-system:status",
      data: { message: `Writing file: ${filePath}` }
    } as FileSystemStatusEvent;
    try {
      const fullPath = resolvePath(filePath, state.cwd);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
      yield {
        type: "action:result",
        data: { action: "writeFile", result: { success: true }, toolCallId },
      };
      yield {
        type: "file-system:status",
        data: { message: `File written successfully`, severity: "success" }
      } as FileSystemStatusEvent;
    } catch (error: any) {
      yield {
        type: "action:result",
        data: { action: "writeFile", result: { error: error.message }, toolCallId },
      };
      yield {
        type: "file-system:status",
        data: { message: `File write failed: ${error.message}`, severity: "error" }
      } as FileSystemStatusEvent;
    }
  });

  builder.on("action:listFiles", async function* (event, { state }) {
    const { path: dirPath, toolCallId } = event.data;
    yield {
      type: "file-system:status",
      data: { message: `Listing files in: ${dirPath}` }
    } as FileSystemStatusEvent;
    try {
      const files = await fs.readdir(resolvePath(dirPath, state.cwd));
      yield {
        type: "file-system:status",
        data: { message: `Files listed successfully`, severity: "success" }
      } as FileSystemStatusEvent;
      yield {
        type: "action:result",
        data: { action: "listFiles", result: { files }, toolCallId },
      };
    } catch (error: any) {
      yield {
        type: "file-system:status",
        data: { message: `Files listing failed: ${error.message}`, severity: "error" }
      } as FileSystemStatusEvent;
      yield {
        type: "action:result",
        data: { action: "listFiles", result: { error: error.message }, toolCallId },
      };
    }
  });

  builder.on("action:deleteFile", async function* (event, { state }) {
    const { path: filePath, toolCallId } = event.data;
    yield {
      type: "file-system:status",
      data: { message: `Deleting file: ${filePath}` }
    } as FileSystemStatusEvent;
    try {
      await fs.unlink(resolvePath(filePath, state.cwd));
      yield {
        type: "action:result",
        data: { action: "deleteFile", result: { success: true }, toolCallId },
      };
      yield {
        type: "file-system:status",
        data: { message: `File deleted successfully`, severity: "success" }
      } as FileSystemStatusEvent;
    } catch (error: any) {
      yield {
        type: "action:result",
        data: { action: "deleteFile", result: { error: error.message }, toolCallId },
      };
      yield {
        type: "file-system:status",
        data: { message: `File deletion failed: ${error.message}`, severity: "error" }
      } as FileSystemStatusEvent;
    }
  });

  builder.on("file-system:status" as any, async function* (event: FileSystemStatusEvent) {
    yield uiEvent(
      statusWidget(event.data.message, event.data.severity)
    );
  });
};
