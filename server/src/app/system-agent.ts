import { melony } from "melony";
import { loadConfig, saveConfig, resolvePath, DEFAULT_BASE_DIR, isConfigured } from "./config.js";
import { 
  listConversations, 
  loadConversationState, 
  loadConversationEvents,
  createChannelConversation,
  deleteChannelConversation,
  loadChannelSpec,
  saveChannelSpec,
  markConversationRead
} from "../services/conversation.js";
import { listAgents, loadAgentConfig, saveAgentConfig, loadAgentMd, saveAgentMd } from "../services/agents.js";
import { getModelCatalog, fetchProviderModels, type ModelProvider } from "../services/model-catalog.js";
import { getVersionStatus } from "../app/version.js";
import { getVariables, updateVariables } from "../services/user-variables.js";
import { listAutomations, createAutomation, updateAutomation, deleteAutomation } from "../services/automations.js";
import { getMarketplaceRegistry, installMarketplacePlugin } from "../services/marketplace.js";
import { DEFAULT_MODEL_ID, DEFAULT_MODEL_BY_PROVIDER } from "../services/model-defaults.js";
import { getUploadsDir, MAX_IMAGE_BYTES, allowedMimeTypes, extensionByMimeType } from "../routes/utils.js";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { exec } from "node:child_process";
import type { ConversationState, ConversationEvent } from "./types.js";

function getUserProfilePath(): string {
  const cfg = loadConfig();
  return path.join(resolvePath(cfg.baseDir || DEFAULT_BASE_DIR), "USER.md");
}

async function getUserProfile(): Promise<string> {
  const p = getUserProfilePath();
  try {
    return await fs.readFile(p, "utf-8");
  } catch {
    return "";
  }
}

async function updateUserProfile(profile: string): Promise<void> {
  const p = getUserProfilePath();
  const dir = path.dirname(p);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(p, profile, "utf-8");
  } catch (error) {
    console.error("Failed to update user profile:", error);
    throw error;
  }
}

import { RuntimeRegistry } from "../registry/runtime-registry.js";

export const createSystemAgent = (registry: RuntimeRegistry) => melony<ConversationState, ConversationEvent>()
  .on("uploads:image", async function* (event) {
    const { name, mimeType, dataBase64 } = event.data as {
      name?: string;
      mimeType?: string;
      dataBase64?: string;
    };

    if (!mimeType || !allowedMimeTypes.has(mimeType)) {
      throw new Error("Unsupported image mime type");
    }

    if (!dataBase64 || typeof dataBase64 !== "string") {
      throw new Error("Image payload is required");
    }

    const bytes = Buffer.from(dataBase64, "base64");
    if (!bytes.length) {
      throw new Error("Invalid image payload");
    }

    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new Error("Image too large (max 8MB)");
    }

    const ext = extensionByMimeType[mimeType] ?? ".bin";
    const now = new Date();
    const y = now.getFullYear().toString();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const datePath = path.join(y, m);
    const fileName = `${Date.now()}-${randomUUID()}${ext}`;
    const id = path.posix.join(y, m, fileName);
    const uploadsDir = getUploadsDir();
    const datedDir = path.join(uploadsDir, datePath);
    await fs.mkdir(datedDir, { recursive: true });
    await fs.writeFile(path.join(datedDir, fileName), bytes);

    // Note: We don't have access to the request's origin here easily, 
    // but the client can construct it or we can return a relative path.
    // For now, let's just return the id and meta.
    yield { 
      type: "uploads:image-result", 
      data: {
        id,
        name: typeof name === "string" && name.trim() ? name.trim() : `image${ext}`,
        mimeType,
        size: bytes.length,
        url: `/api/uploads/${id.split('/').map(encodeURIComponent).join('/')}`
      }
    } as any;
  })
  .on("config:get", async function* () {
    const config = loadConfig();
    yield { 
      type: "config:result", 
      data: {
        configured: isConfigured(),
        name: config.name || "OpenBot",
        description: config.description || "A specialized AI agent",
        model: config.model || DEFAULT_MODEL_ID,
        image: config.image,
        defaultModelId: DEFAULT_MODEL_ID,
        defaultModels: DEFAULT_MODEL_BY_PROVIDER,
        hasOpenAIKey: !!(config.openaiApiKey || process.env.OPENAI_API_KEY),
        hasAnthropicKey: !!(config.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
      }
    } as any;
  })
  .on("config:update", async function* (event) {
    const next = { ...loadConfig(), ...event.data };
    saveConfig(next);
    yield { type: "config:result", data: next } as any;
  })
  .on("conversations:list", async function* () {
    const list = await listConversations();
    yield { type: "conversations:list-result", data: list } as any;
  })
  .on("conversations:subscribe", async function* (event, { runtime, state }) {
    // This is a special event that doesn't return immediately.
    // In the events router, we'll handle the long-lived connection.
    // Actually, melony runtimes are meant to finish.
    // But we can use this to trigger a subscription in the router.
    yield { type: "conversations:subscribed", data: { conversationId: state.conversationId } } as any;
  })
  .on("conversations:get-state", async function* (event) {
    const state = await loadConversationState(event.data.conversationId);
    yield { type: "conversations:state-result", data: state } as any;
  })
  .on("conversations:get-events", async function* (event) {
    const events = await loadConversationEvents(event.data.conversationId, event.data.afterId);
    yield { type: "conversations:events-result", data: events } as any;
  })
  .on("conversations:mark-read", async function* (event) {
    await markConversationRead(event.data.conversationId);
    yield { type: "conversations:mark-read-result", data: { success: true } } as any;
  })
  .on("channels:list", async function* () {
    const list = await listConversations("channel");
    yield { type: "channels:list-result", data: list } as any;
  })
  .on("channels:create", async function* (event) {
    const channel = await createChannelConversation(event.data.name);
    yield { type: "channels:create-result", data: channel } as any;
  })
  .on("channels:delete", async function* (event) {
    const success = await deleteChannelConversation(event.data.conversationId);
    yield { type: "channels:delete-result", data: { success } } as any;
  })
  .on("channels:get-spec", async function* (event) {
    const spec = await loadChannelSpec(event.data.conversationId);
    yield { type: "channels:spec-result", data: { spec } } as any;
  })
  .on("channels:update-spec", async function* (event) {
    await saveChannelSpec(event.data.conversationId, event.data.spec);
    yield { type: "channels:spec-result", data: { spec: event.data.spec } } as any;
  })
  .on("agents:list", async function* () {
    const agents = await listAgents();
    yield { type: "agents:list-result", data: agents } as any;
  })
  .on("agents:get-config", async function* (event) {
    const config = await loadAgentConfig(event.data.agentId);
    yield { type: "agents:config-result", data: config } as any;
  })
  .on("agents:update-config", async function* (event) {
    await saveAgentConfig(event.data.agentId, event.data.config);
    yield { type: "agents:config-result", data: event.data.config } as any;
  })
  .on("agents:get-md", async function* (event) {
    const md = await loadAgentMd(event.data.agentId);
    yield { type: "agents:md-result", data: { md } } as any;
  })
  .on("agents:update-md", async function* (event) {
    await saveAgentMd(event.data.agentId, event.data.md);
    yield { type: "agents:md-result", data: { md: event.data.md } } as any;
  })
  .on("plugins:list", async function* () {
    const plugins = registry.getTools().map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
    }));
    yield { type: "plugins:list-result", data: plugins } as any;
  })
  .on("plugins:registry-list", async function* () {
    // This is for marketplace/registry plugins. 
    // For now we just return built-in ones or empty.
    const plugins = registry.getTools().filter(p => (p as any).isBuiltIn).map(p => ({
      name: p.name,
      description: p.description,
      isBuiltIn: true,
    }));
    yield { type: "plugins:registry-list-result", data: plugins } as any;
  })
  .on("models:list", async function* () {
    const models = await getModelCatalog();
    yield { type: "models:list-result", data: models } as any;
  })
  .on("models:preview", async function* (event) {
    const { provider, apiKey } = event.data as { provider: ModelProvider; apiKey: string };
    const models = await fetchProviderModels(provider, apiKey);
    yield { type: "models:list-result", data: models } as any;
  })
  .on("version:get", async function* () {
    const status = await getVersionStatus();
    yield { type: "version:result", data: status } as any;
  })
  .on("user:get-profile", async function* () {
    const profile = await getUserProfile();
    yield { type: "user:profile-result", data: { profile } } as any;
  })
  .on("user:update-profile", async function* (event) {
    await updateUserProfile(event.data.profile);
    yield { type: "user:profile-result", data: { profile: event.data.profile } } as any;
  })
  .on("variables:list", async function* () {
    const variables = await getVariables();
    yield { type: "variables:list-result", data: variables } as any;
  })
  .on("variables:update", async function* (event) {
    await updateVariables(event.data.variables);
    const variables = await getVariables();
    yield { type: "variables:list-result", data: variables } as any;
  })
  .on("marketplace:list", async function* () {
    const registry = await getMarketplaceRegistry();
    yield { type: "marketplace:list-result", data: registry.plugins } as any;
  })
  .on("marketplace:install", async function* (event) {
    const result = await installMarketplacePlugin(event.data.id);
    yield { type: "marketplace:install-result", data: { success: true, ...result } } as any;
  })
  .on("automations:list", async function* () {
    const list = await listAutomations();
    yield { type: "automations:list-result", data: list } as any;
  })
  .on("automations:create", async function* (event) {
    const automation = await createAutomation(event.data);
    yield { type: "automations:create-result", data: automation } as any;
  })
  .on("automations:update", async function* (event) {
    const automation = await updateAutomation(event.data.id, event.data);
    yield { type: "automations:update-result", data: automation } as any;
  })
  .on("automations:delete", async function* (event) {
    const success = await deleteAutomation(event.data.id);
    yield { type: "automations:delete-result", data: { success } } as any;
  })
  .on("actions:open-folder", async function* (event) {
    const { folder } = event.data;
    if (folder) {
      const command = os.platform() === 'win32' ? `explorer "${folder}"` : os.platform() === 'darwin' ? `open "${folder}"` : `xdg-open "${folder}"`;
      exec(command, (error) => { if (error) console.error(`Failed to open folder: ${error.message}`); });
    }
    yield { type: "actions:result", data: { success: true } } as any;
  })
  .on("actions:reload", async function* (event, { state }) {
     // Triggering a reload is hard from inside the agent because it destroys the runtime.
     // But we can signal it. Actually, the ServerContext has scheduleReload.
     // For now, let's just yield a message.
     yield { type: "actions:result", data: { success: true, message: "Reloading runtime..." } } as any;
  })
  .on("prompts:list", async function* () {
    const list = [
      { label: 'Who are you?', icon: 'user' },
      { label: 'Who am I?', icon: 'help-circle' },
      { label: 'How can you help me?', icon: 'sparkles' },
      { label: 'What is the weather in Tokyo?', icon: 'sun' },
    ];
    yield { type: "prompts:list-result", data: list } as any;
  })
  .on("message:reaction", async function* (event, { state }) {
    const { targetMessageId, reaction } = event.data;
    // We already handle reactions via markConversationRead or similar if needed.
    // But here we can just acknowledge.
    yield { type: "message:reaction-result", data: { success: true } } as any;
  })
  .build();
