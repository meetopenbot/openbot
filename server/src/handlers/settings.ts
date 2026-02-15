import { ChatEvent, ChatState, UpdateSettingsEvent } from "../types.js";
import { saveConfig } from "../config.js";
import { RuntimeContext } from "melony";
import { tabOnlyUI } from "../ui/layout.js";
import { exec } from "node:child_process";
import os from "node:os";

/**
 * Handle settings updates (like API keys)
 */
export async function* updateSettingsHandler(
  event: UpdateSettingsEvent,
  { state }: RuntimeContext<ChatState, ChatEvent>
): AsyncGenerator<ChatEvent, void, unknown> {
  const { openai_api_key, anthropic_api_key, model } = event.data;

  const updates: any = {};

  if (model) {
    updates.model = model.trim();
  }

  if (openai_api_key && openai_api_key !== "••••••••••••••••") {
    updates.openaiApiKey = openai_api_key.trim();
  }

  if (anthropic_api_key && anthropic_api_key !== "••••••••••••••••") {
    updates.anthropicApiKey = anthropic_api_key.trim();
  }

  if (Object.keys(updates).length > 0) {
    saveConfig(updates);

    // Refresh the settings UI to show the "saved" state (masking the keys)
    yield {
      type: "ui",
      meta: {
        type: "content",
      },
      data: await tabOnlyUI({ tab: "settings" })
    } as unknown as ChatEvent;
  }
}

/**
 * Handle opening an agent's folder in the native file explorer
 */
export async function* openAgentFolderHandler(
  event: any,
): AsyncGenerator<ChatEvent, void, unknown> {
  const { folder } = event.data;

  if (folder) {
    const command = os.platform() === "win32" ? `explorer "${folder}"` :
      os.platform() === "darwin" ? `open "${folder}"` :
        `xdg-open "${folder}"`;

    exec(command, (error) => {
      if (error) {
        console.error(`Failed to open folder: ${error.message}`);
      }
    });
  }
}
