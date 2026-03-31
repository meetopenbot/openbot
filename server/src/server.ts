import "dotenv/config";
import express from "express";
import cors from "cors";
import { generateId } from "melony";
import { createOpenBot } from "./open-bot.js";
import { loadConfig, saveConfig, isConfigured, resolvePath, DEFAULT_BASE_DIR, DEFAULT_AGENT_MD } from "./config.js";
import {
  loadConversationState,
  saveConversationState,
  logConversationEvent,
  loadConversationEvents,
  listConversations,
  createChannelConversation,
  deleteChannelConversation,
  normalizeConversationId,
} from "./conversation.js";
import { listPlugins } from "./registry/index.js";
import { readAgentConfig } from "./registry/plugin-loader.js";
import { exec } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import matter from "gray-matter";
import type { ManagerEvent, ManagerState, ManagerRequest } from "./types.js";
import { fetchProviderModels, getModelCatalog } from "./model-catalog.js";
import type { ModelProvider } from "./model-catalog.js";
import { DEFAULT_MODEL_BY_PROVIDER, DEFAULT_MODEL_ID } from "./model-defaults.js";
import { listAutomations, saveAutomations, type AutomationRecord } from "./automations.js";
import { startAutomationWorker } from "./automation-worker.js";
import { getMarketplaceRegistry, installMarketplaceAgent, installMarketplacePlugin } from "./marketplace.js";
import { getVersionStatus } from "./version.js";

export interface ServerOptions {
  port?: string | number;
  openaiApiKey?: string;
  anthropicApiKey?: string;
}

export async function startServer(options: ServerOptions = {}) {
  const config = loadConfig();
  const baseDir = config.baseDir || DEFAULT_BASE_DIR;
  const resolvedBaseDir = resolvePath(baseDir);
  const PORT = Number(options.port ?? config.port ?? process.env.PORT ?? 4001);
  const app = express();

  const createRuntime = () => createOpenBot({
    openaiApiKey: options.openaiApiKey,
    anthropicApiKey: options.anthropicApiKey,
  });

  let runtime = await createRuntime();

  let reloadTimer: NodeJS.Timeout | null = null;
  let reloadInProgress = false;
  let queuedReload = false;

  const reloadRuntime = async () => {
    if (reloadInProgress) {
      queuedReload = true;
      return;
    }

    reloadInProgress = true;
    try {
      const nextRuntime = await createRuntime();
      runtime = nextRuntime;
      console.log("[hot-reload] Runtime reloaded from ~/.openbot changes");
    } catch (error) {
      console.error("[hot-reload] Reload failed; keeping previous runtime", error);
    } finally {
      reloadInProgress = false;
      if (queuedReload) {
        queuedReload = false;
        scheduleReload();
      }
    }
  };

  const scheduleReload = () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      void reloadRuntime();
    }, 800);
  };

  const openBotDir = resolvedBaseDir;
  const agentsDir = path.join(openBotDir, "agents");
  const pluginsDir = path.join(openBotDir, "plugins");
  await fs.mkdir(agentsDir, { recursive: true });
  await fs.mkdir(pluginsDir, { recursive: true });

  const cleanupWatcher = async () => {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
  };

  const runAutomation = async (automation: AutomationRecord, scheduledAt: Date) => {
    const conversationId = `channel_automation_${automation.id}`;
    const runId = `run_auto_${generateId()}`;
    const state: ManagerState = (await loadConversationState(conversationId)) ?? {};

    state.conversationId = conversationId;
    if (!state.cwd) state.cwd = process.cwd();
    if (!state.workspaceRoot) state.workspaceRoot = process.cwd();
    if (!state.title) state.title = `Automation: ${automation.name}`;

    const content =
      automation.targetType === "agent" && automation.agentName
        ? `/${automation.agentName} ${automation.prompt}`
        : automation.prompt;

    const iterator = runtime.run(
      {
        type: "agent:input",
        data: { content },
      },
      { runId, state }
    );

    try {
      console.log(
        `[automations] Running "${automation.name}" (${automation.id}) at ${scheduledAt.toISOString()}`
      );
      for await (const chunk of iterator) {
        await logConversationEvent(conversationId, runId, chunk);
      }
      console.log(`[automations] Completed "${automation.name}" (${automation.id})`);
    } catch (error) {
      console.error(`[automations] Run failed for "${automation.name}" (${automation.id})`, error);
      throw error;
    } finally {
      await saveConversationState(conversationId, state);
    }
  };

  const stopAutomationWorker = startAutomationWorker({
    listAutomations,
    runAutomation,
  });

  const cleanupBackground = async () => {
    stopAutomationWorker();
    await cleanupWatcher();
  };

  process.once("SIGINT", () => {
    void cleanupBackground().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void cleanupBackground().finally(() => process.exit(0));
  });

  app.use(cors());
  app.use(express.json({ limit: "20mb" }));

  const fileExists = async (targetPath: string) =>
    fs.access(targetPath).then(() => true).catch(() => false);

  const toTitleCaseFromSlug = (value: string) =>
    value
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Agent";

  const resolveAgentFolder = async (
    agentIdOrName: string,
    resolvedBaseDir: string,
  ): Promise<string | null> => {
    const agentsDir = path.join(resolvedBaseDir, "agents");
    const directFolder = path.join(agentsDir, agentIdOrName);
    if (await fileExists(path.join(directFolder, "AGENT.md"))) {
      return directFolder;
    }

    try {
      const allPlugins = await listPlugins(agentsDir);
      const match = allPlugins.find((plugin) =>
        plugin.type === "agent"
        && (path.basename(plugin.folder) === agentIdOrName || plugin.name === agentIdOrName)
      );
      return match?.folder ?? null;
    } catch {
      return null;
    }
  };

  const getUploadsDir = () => {
    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    return path.join(resolvedBaseDir, "uploads");
  };

  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const allowedMimeTypes = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/svg+xml",
  ]);
  const extensionByMimeType: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
  };

  // Return available models to the client.
  // It prefers fresh provider APIs and falls back to bundled defaults.
  app.get("/api/models", async (_req, res) => {
    try {
      const models = await getModelCatalog();
      res.json(models);
    } catch (err) {
      console.error("Failed to load models:", err);
      res.json([]);
    }
  });

  app.get("/api/version", async (_req, res) => {
    try {
      const status = await getVersionStatus();
      res.json(status);
    } catch (err) {
      console.error("Failed to check version:", err);
      res.status(500).json({ error: "Failed to check version" });
    }
  });

  app.post("/api/models/preview", async (req, res) => {
    const { provider, apiKey } = req.body as {
      provider?: string;
      apiKey?: string;
    };

    if (provider !== "openai" && provider !== "anthropic") {
      return res.status(400).json({ error: "Invalid provider" });
    }

    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return res.status(400).json({ error: "API key is required" });
    }

    try {
      const models = await fetchProviderModels(provider as ModelProvider, apiKey.trim());
      res.json(models);
    } catch (err) {
      console.error("Failed to preview models:", err);
      res.status(502).json({ error: "Failed to fetch models from provider" });
    }
  });

  app.get("/", async (_req, res) => {
    res.json({
      message: "OpenBot API server",
      version: "2.0",
      endpoints: {
        chat: "POST /api/chat",
        config: "GET|POST /api/config",
        conversations: "GET /api/conversations",
        agents: "GET|POST /api/agents",
        prompts: "GET /api/prompts",
        version: "GET /api/version",
      },
    });
  });

  // ─── REST API ───────────────────────────────────────────────────

  app.get("/api/prompts", async (_req, res) => {
    res.json([
      { label: "Who are you?", icon: "user" },
      { label: "Who am I?", icon: "help-circle" },
      { label: "How can you help me?", icon: "sparkles" },
      { label: "What is the weather in Tokyo?", icon: "sun" },
    ]);
  });

  app.get("/api/automations", async (_req, res) => {
    const items = await listAutomations();
    res.json(items);
  });

  app.post("/api/automations", async (req, res) => {
    const { name, prompt, cron, targetType, agentName } = req.body as {
      name?: string;
      prompt?: string;
      cron?: string;
      targetType?: "orchestrator" | "agent";
      agentName?: string;
    };

    const normalizedTargetType = targetType === "agent" ? "agent" : "orchestrator";
    const normalizedAgentName = typeof agentName === "string" ? agentName.trim() : "";

    if (
      typeof name !== "string" ||
      typeof prompt !== "string" ||
      typeof cron !== "string" ||
      !name.trim() ||
      !prompt.trim() ||
      !cron.trim() ||
      (normalizedTargetType === "agent" && !normalizedAgentName)
    ) {
      return res.status(400).json({ error: "Invalid automation payload" });
    }

    const now = new Date().toISOString();
    const next: AutomationRecord = {
      id: `auto_${randomUUID()}`,
      name: name.trim(),
      prompt: prompt.trim(),
      cron: cron.trim(),
      targetType: normalizedTargetType,
      agentName: normalizedTargetType === "agent" ? normalizedAgentName : undefined,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    const current = await listAutomations();
    await saveAutomations([next, ...current]);
    res.status(201).json(next);
  });

  app.put("/api/automations/:id", async (req, res) => {
    const { id } = req.params;
    const { name, prompt, cron, enabled, targetType, agentName } = req.body as {
      name?: string;
      prompt?: string;
      cron?: string;
      enabled?: boolean;
      targetType?: "orchestrator" | "agent";
      agentName?: string;
    };

    const current = await listAutomations();
    const index = current.findIndex((item) => item.id === id);
    if (index < 0) {
      return res.status(404).json({ error: "Automation not found" });
    }

    const existing = current[index];
    const nextTargetType = targetType === "agent"
      ? "agent"
      : targetType === "orchestrator"
        ? "orchestrator"
        : existing.targetType;
    const nextAgentName = typeof agentName === "string"
      ? agentName.trim()
      : (existing.agentName ?? "");

    if (nextTargetType === "agent" && !nextAgentName) {
      return res.status(400).json({ error: "agentName is required when targetType is agent" });
    }

    const updated: AutomationRecord = {
      ...existing,
      name: typeof name === "string" ? name.trim() || existing.name : existing.name,
      prompt: typeof prompt === "string" ? prompt.trim() || existing.prompt : existing.prompt,
      cron: typeof cron === "string" ? cron.trim() || existing.cron : existing.cron,
      targetType: nextTargetType,
      agentName: nextTargetType === "agent" ? nextAgentName : undefined,
      enabled: typeof enabled === "boolean" ? enabled : existing.enabled,
      updatedAt: new Date().toISOString(),
    };

    current[index] = updated;
    await saveAutomations(current);
    res.json(updated);
  });

  app.delete("/api/automations/:id", async (req, res) => {
    const { id } = req.params;
    const current = await listAutomations();
    const next = current.filter((item) => item.id !== id);
    if (next.length === current.length) {
      return res.status(404).json({ error: "Automation not found" });
    }
    await saveAutomations(next);
    res.json({ success: true });
  });

  app.post("/api/uploads/image", async (req, res) => {
    const { name, mimeType, dataBase64 } = req.body as {
      name?: string;
      mimeType?: string;
      dataBase64?: string;
    };

    if (!mimeType || !allowedMimeTypes.has(mimeType)) {
      return res.status(400).json({ error: "Unsupported image mime type" });
    }

    if (!dataBase64 || typeof dataBase64 !== "string") {
      return res.status(400).json({ error: "Image payload is required" });
    }

    const bytes = Buffer.from(dataBase64, "base64");
    if (!bytes.length) {
      return res.status(400).json({ error: "Invalid image payload" });
    }

    if (bytes.length > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: "Image too large (max 8MB)" });
    }

    try {
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

      const origin = `${req.protocol}://${req.get("host")}`;
      const encodedId = id.split("/").map(encodeURIComponent).join("/");
      res.json({
        id,
        name: typeof name === "string" && name.trim() ? name.trim() : `image${ext}`,
        mimeType,
        size: bytes.length,
        url: `${origin}/api/uploads/${encodedId}`,
      });
    } catch (error) {
      console.error("Image upload failed:", error);
      res.status(500).json({ error: "Failed to store image" });
    }
  });

  app.get("/api/uploads/*", async (req, res) => {
    const rawPath = (req.params as any)[0];
    if (!rawPath || rawPath.includes("\\")) {
      return res.status(400).send("Invalid upload id");
    }

    const normalized = path.posix.normalize(rawPath);
    if (normalized.startsWith("../") || normalized === "..") {
      return res.status(400).send("Invalid upload id");
    }

    const uploadsDir = getUploadsDir();
    const filePath = path.join(uploadsDir, normalized);

    try {
      await fs.access(filePath);
      res.sendFile(filePath);
    } catch {
      res.status(404).send("Upload not found");
    }
  });

  app.get("/api/config", async (_req, res) => {
    const cfg = loadConfig();
    res.json({
      configured: isConfigured(),
      name: cfg.name || "OpenBot",
      description: cfg.description || "The main orchestrator and system settings",
      model: cfg.model || DEFAULT_MODEL_ID,
      defaultModelId: DEFAULT_MODEL_ID,
      defaultModels: DEFAULT_MODEL_BY_PROVIDER,
      hasOpenAIKey: !!cfg.openaiApiKey,
      hasAnthropicKey: !!cfg.anthropicApiKey,
    });
  });

  app.post("/api/config", async (req, res) => {
    const { openai_api_key, anthropic_api_key, model, name, description, image } = req.body;
    const updates: Record<string, string> = {};

    if (name) updates.name = name.trim();
    if (description) updates.description = description.trim();
    if (model) updates.model = model.trim();
    if (image !== undefined) updates.image = image.trim();
    if (openai_api_key && openai_api_key !== "••••••••••••••••")
      updates.openaiApiKey = openai_api_key.trim();
    if (anthropic_api_key && anthropic_api_key !== "••••••••••••••••")
      updates.anthropicApiKey = anthropic_api_key.trim();

    if (Object.keys(updates).length > 0) {
      saveConfig(updates);
      scheduleReload();
    }

    res.json({ success: true });
  });

  app.get("/api/conversations", async (_req, res) => {
    const conversations = await listConversations();
    res.json(conversations);
  });

  app.post("/api/channels", async (req, res) => {
    const { name } = req.body as { name?: string };
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Channel name is required" });
    }

    try {
      const channel = await createChannelConversation(name);
      return res.status(201).json({ success: true, channel });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create channel";
      if (message === "Channel already exists") {
        return res.status(409).json({ error: message });
      }
      if (message === "Invalid channel name" || message === "Channel name is required") {
        return res.status(400).json({ error: message });
      }
      console.error(error);
      return res.status(500).json({ error: "Failed to create channel" });
    }
  });

  app.delete("/api/channels/:id", async (req, res) => {
    const id = normalizeConversationId(req.params.id);

    const deleted = await deleteChannelConversation(id);
    if (!deleted) {
      return res.status(404).json({ error: "Channel not found" });
    }
    return res.json({ success: true });
  });

  app.get("/api/conversations/:id/events", async (req, res) => {
    const conversationId = normalizeConversationId(req.params.id);
    const events = await loadConversationEvents(conversationId);
    res.json(events);
  });

  app.get("/api/agents", async (_req, res) => {
    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const agentsDir = path.join(resolvedBaseDir, "agents");

    const defaultName = cfg.name || "OpenBot";
    const defaultDescription = cfg.description || "The main orchestrator and system settings";

    const agents: any[] = [
      {
        id: "default",
        name: defaultName,
        description: defaultDescription,
        folder: resolvedBaseDir,
        isDefault: true,
        hasAgentMd: true,
        image: cfg.image,
      },
    ];

    try {
      const allPlugins = await listPlugins(agentsDir);
      const agentPlugins = allPlugins.filter(p => p.type === "agent");
      agents.push(
        ...agentPlugins.map((plugin) => {
          const id = path.basename(plugin.folder);
          const hasUnnamedDisplayName = /^Unnamed\s+(Plugin|Tool|Agent)$/i.test(plugin.name);
          return {
            ...plugin,
            id,
            name: hasUnnamedDisplayName ? toTitleCaseFromSlug(id) : plugin.name,
          };
        })
      );
    } catch {
      // ignore
    }
    res.json(agents);
  });

  app.post("/api/agents", async (req, res) => {
    const body = req.body as {
      id?: string;
      name?: string;
      description?: string;
      model?: string;
      image?: string;
      plugins?: Array<string | { name: string; config?: unknown }>;
      subscribe?: string[];
      md?: string;
    };

    const normalizedId = (body.id || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-_]*$/.test(normalizedId)) {
      return res.status(400).json({ error: "Invalid agent id. Use lowercase letters, numbers, dashes, and underscores." });
    }

    const normalizedName = (body.name || "").trim();
    const normalizedDescription = (body.description || "").trim();
    if (!normalizedName || !normalizedDescription) {
      return res.status(400).json({ error: "name and description are required" });
    }

    const normalizedPlugins: Array<string | { name: string; config?: unknown }> = [];
    for (const plugin of body.plugins || []) {
      if (typeof plugin === "string") {
        const normalized = plugin.trim();
        if (normalized) normalizedPlugins.push(normalized);
        continue;
      }
      if (!plugin || typeof plugin !== "object" || typeof plugin.name !== "string") continue;
      const normalizedName = plugin.name.trim();
      if (!normalizedName) continue;
      if (typeof plugin.config === "undefined") normalizedPlugins.push({ name: normalizedName });
      else normalizedPlugins.push({ name: normalizedName, config: plugin.config });
    }

    const normalizedSubscribe = Array.isArray(body.subscribe)
      ? body.subscribe.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
      : [];

    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const agentDir = path.join(resolvedBaseDir, "agents", normalizedId);
    const mdPath = path.join(agentDir, "AGENT.md");

    try {
      await fs.access(agentDir);
      return res.status(409).json({ error: `Agent "${normalizedId}" already exists` });
    } catch {
      // expected for new agent
    }

    const frontmatter: Record<string, unknown> = {
      name: normalizedName,
      description: normalizedDescription,
      plugins: normalizedPlugins,
    };
    if (typeof body.model === "string" && body.model.trim()) frontmatter.model = body.model.trim();
    if (typeof body.image === "string" && body.image.trim()) frontmatter.image = body.image.trim();
    if (normalizedSubscribe.length > 0) frontmatter.subscribe = normalizedSubscribe;

    try {
      await fs.mkdir(agentDir, { recursive: true });
      const content = matter.stringify((body.md || "").trim(), frontmatter);
      await fs.writeFile(mdPath, content, "utf-8");
      scheduleReload();
      res.status(201).json({ success: true, id: normalizedId });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create agent" });
    }
  });

  app.get("/api/plugins", async (_req, res) => {
    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const pluginsDir = path.join(resolvedBaseDir, "plugins");

    try {
      const allPlugins = await listPlugins(pluginsDir);
      const toolPlugins = allPlugins.filter((plugin) => plugin.type === "tool");
      res.json(
        toolPlugins.map((plugin) => {
          const id = path.basename(plugin.folder);
          const hasUnnamedDisplayName = /^Unnamed\s+(Plugin|Tool|Agent)$/i.test(plugin.name);
          return {
            ...plugin,
            id,
            name: hasUnnamedDisplayName ? toTitleCaseFromSlug(id) : plugin.name,
          };
        })
      );
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to list plugins" });
    }
  });

  app.get("/api/registry/plugins", async (_req, res) => {
    try {
      const tools = runtime.registry.getTools();
      res.json(
        tools.map((t) => ({
          name: t.name,
          description: t.description,
          isBuiltIn: !!t.isBuiltIn,
        }))
      );
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to list registry plugins" });
    }
  });

  app.get("/api/marketplace/agents", async (_req, res) => {
    try {
      const registry = await getMarketplaceRegistry();
      res.json(registry.agents);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to load marketplace agents" });
    }
  });

  app.get("/api/marketplace/plugins", async (_req, res) => {
    try {
      const registry = await getMarketplaceRegistry();
      res.json(registry.plugins);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to load marketplace plugins" });
    }
  });

  app.post("/api/marketplace/install-agent", async (req, res) => {
    const { id } = req.body as { id?: string };
    if (typeof id !== "string" || !id.trim()) {
      return res.status(400).json({ error: "Marketplace agent id is required" });
    }
    try {
      const result = await installMarketplaceAgent(id.trim());
      scheduleReload();
      res.json({ success: true, installedName: result.installedName, item: result.agent });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to install agent" });
    }
  });

  app.post("/api/marketplace/install-plugin", async (req, res) => {
    const { id } = req.body as { id?: string };
    if (typeof id !== "string" || !id.trim()) {
      return res.status(400).json({ error: "Marketplace plugin id is required" });
    }
    try {
      const result = await installMarketplacePlugin(id.trim());
      scheduleReload();
      res.json({ success: true, installedName: result.installedName, item: result.plugin });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to install plugin" });
    }
  });

  app.get("/api/agents/:agentId/md", async (req, res) => {
    const { agentId } = req.params;
    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const defaultName = cfg.name || "OpenBot";

    let mdPath: string;
    if (agentId === defaultName || agentId === "default") {
      mdPath = path.join(resolvedBaseDir, "AGENT.md");
    } else {
      const pluginFolder = await resolveAgentFolder(agentId, resolvedBaseDir);
      if (!pluginFolder) {
        return res.status(404).send("");
      }
      mdPath = path.join(pluginFolder, "AGENT.md");
    }

    try {
      const content = await fs.readFile(mdPath, "utf-8");
      const { content: body } = matter(content);
      res.send(body.trim());
    } catch {
      res.status(404).send("");
    }
  });

  app.put("/api/agents/:agentId/md", async (req, res) => {
    const { agentId } = req.params;
    const { md } = req.body;
    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const defaultName = cfg.name || "OpenBot";

    let mdPath: string;
    let pluginDir: string;
    if (agentId === defaultName || agentId === "default") {
      pluginDir = resolvedBaseDir;
      mdPath = path.join(resolvedBaseDir, "AGENT.md");
    } else {
      const pluginFolder = await resolveAgentFolder(agentId, resolvedBaseDir);
      if (!pluginFolder) {
        return res.status(404).json({ error: "Agent not found" });
      }
      pluginDir = pluginFolder;
      mdPath = path.join(pluginDir, "AGENT.md");
    }

    try {
      await fs.mkdir(pluginDir, { recursive: true });

      let frontmatter = {};
      try {
        const currentContent = await fs.readFile(mdPath, "utf-8");
        const parsed = matter(currentContent);
        frontmatter = parsed.data || {};
      } catch {
        // No current AGENT.md, starting with empty frontmatter or defaults
      }

      const consolidated = matter.stringify(md, frontmatter);
      await fs.writeFile(mdPath, consolidated, "utf-8");
      scheduleReload();
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to write AGENT.md" });
    }
  });

  app.get("/api/agents/:agentId/config", async (req, res) => {
    const { agentId } = req.params;
    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const defaultName = cfg.name || "OpenBot";

    let mdPath: string;
    if (agentId === defaultName || agentId === "default") {
      mdPath = path.join(resolvedBaseDir, "AGENT.md");
    } else {
      const pluginFolder = await resolveAgentFolder(agentId, resolvedBaseDir);
      if (!pluginFolder) {
        return res.status(404).json({ error: "Agent not found or invalid format" });
      }
      mdPath = path.join(pluginFolder, "AGENT.md");
    }

    try {
      const content = await fs.readFile(mdPath, "utf-8");
      const { data: parsed, content: body } = matter(content);

      if (!parsed || typeof parsed !== "object") {
        return res.status(400).json({ error: "Invalid AGENT.md frontmatter" });
      }

      res.json({
        name: typeof parsed.name === "string" ? parsed.name : (agentId === defaultName || agentId === "default" ? defaultName : ""),
        description: typeof parsed.description === "string" ? parsed.description : (agentId === defaultName || agentId === "default" ? cfg.description || "" : ""),
        model: typeof parsed.model === "string" ? parsed.model : (agentId === defaultName || agentId === "default" ? cfg.model : undefined),
        image: typeof parsed.image === "string" ? parsed.image : (agentId === defaultName || agentId === "default" ? cfg.image : undefined),
        plugins: Array.isArray(parsed.plugins) ? parsed.plugins : [],
        subscribe: Array.isArray(parsed.subscribe)
          ? parsed.subscribe.filter((item: unknown) => typeof item === "string")
          : [],
      });
    } catch {
      if (agentId === defaultName || agentId === "default") {
        // Fallback for default agent if AGENT.md is missing or unreadable
        return res.json({
          name: defaultName,
          description: cfg.description || "",
          model: cfg.model,
          image: cfg.image,
          plugins: [],
          systemPrompt: "",
          subscribe: [],
        });
      }
      res.status(404).json({ error: "Agent not found or invalid format" });
    }
  });

  app.put("/api/agents/:agentId/config", async (req, res) => {
    const { agentId } = req.params;
    const body = req.body as {
      name?: string;
      description?: string;
      model?: string;
      image?: string;
      plugins?: Array<string | { name: string; config?: unknown }>;
      subscribe?: string[];
    };

    if (
      typeof body.name !== "string" ||
      typeof body.description !== "string" ||
      !Array.isArray(body.plugins)
    ) {
      return res.status(400).json({ error: "Invalid agent config payload" });
    }

    const normalizedPlugins: Array<string | { name: string; config?: unknown }> = [];
    for (const plugin of body.plugins) {
      if (typeof plugin === "string") {
        const normalized = plugin.trim();
        if (normalized) normalizedPlugins.push(normalized);
        continue;
      }

      if (!plugin || typeof plugin !== "object" || typeof plugin.name !== "string") {
        continue;
      }

      const normalizedName = plugin.name.trim();
      if (!normalizedName) continue;

      if (typeof plugin.config === "undefined") {
        normalizedPlugins.push({ name: normalizedName });
      } else {
        normalizedPlugins.push({ name: normalizedName, config: plugin.config });
      }
    }

    const normalizedName = body.name.trim();
    const normalizedDescription = body.description.trim();

    if (!normalizedName || !normalizedDescription) {
      return res.status(400).json({ error: "name and description are required" });
    }

    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const defaultName = cfg.name || "OpenBot";

    let pluginDir: string;
    let mdPath: string;
    if (agentId === defaultName || agentId === "default") {
      pluginDir = resolvedBaseDir;
      mdPath = path.join(resolvedBaseDir, "AGENT.md");
    } else {
      const pluginFolder = await resolveAgentFolder(agentId, resolvedBaseDir);
      if (!pluginFolder) {
        return res.status(404).json({ error: "Agent not found" });
      }
      pluginDir = pluginFolder;
      mdPath = path.join(pluginDir, "AGENT.md");
    }

    // Read current content to preserve the body (instructions)
    let currentBody = "";
    try {
      const currentContent = await fs.readFile(mdPath, "utf-8");
      const parsed = matter(currentContent);
      currentBody = parsed.content;
    } catch {
      // No current AGENT.md, starting with empty body or defaults
    }

    // Prepare frontmatter
    const frontmatter: Record<string, unknown> = {
      name: normalizedName,
      description: normalizedDescription,
      plugins: normalizedPlugins,
    };

    if (typeof body.model === "string" && body.model.trim()) {
      frontmatter.model = body.model.trim();
    }

    if (typeof body.image === "string" && body.image.trim()) {
      frontmatter.image = body.image.trim();
    }

    if (Array.isArray(body.subscribe) && body.subscribe.length > 0) {
      const normalizedSubscribe = body.subscribe
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
      if (normalizedSubscribe.length > 0) {
        frontmatter.subscribe = normalizedSubscribe;
      }
    }

    try {
      await fs.mkdir(pluginDir, { recursive: true });

      const consolidated = matter.stringify(currentBody, frontmatter);
      await fs.writeFile(mdPath, consolidated, "utf-8");

      if (agentId === defaultName || agentId === "default") {
        // For the default agent, sync changes back to config.json
        saveConfig({
          name: normalizedName,
          description: normalizedDescription,
          model: (typeof body.model === "string" && body.model.trim()) ? body.model.trim() : undefined,
        });
      }

      scheduleReload();
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to write AGENT.md" });
    }
  });

  app.post("/api/actions/reload", async (_req, res) => {
    scheduleReload();
    res.json({ success: true, message: "Reload scheduled" });
  });

  app.post("/api/actions/open-folder", async (req, res) => {
    const { folder } = req.body;

    if (folder) {
      const command =
        os.platform() === "win32"
          ? `explorer "${folder}"`
          : os.platform() === "darwin"
            ? `open "${folder}"`
            : `xdg-open "${folder}"`;

      exec(command, (error) => {
        if (error) console.error(`Failed to open folder: ${error.message}`);
      });
    }

    res.json({ success: true });
  });

  app.get("/api/agents/:name/avatar", async (req, res) => {
    const { name } = req.params;
    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const defaultName = cfg.name || "OpenBot";

    // 1. Resolve agent folder
    let agentFolder: string | null = null;
    if (name === defaultName || name === "default") {
      agentFolder = resolvedBaseDir;
    } else {
      agentFolder = await resolveAgentFolder(name, resolvedBaseDir);
    }

    // 2. Check for remote image in AGENT.md if folder exists
    if (agentFolder) {
      try {
        const { image } = await readAgentConfig(agentFolder);
        if (image && (image.startsWith("http://") || image.startsWith("https://"))) {
          return res.redirect(image);
        }
      } catch {
        // ignore
      }
    }

    const extensions = [".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif"];
    const fileNames = ["avatar", "icon", "image", "logo"];

    const searchDirs = [
      (name === defaultName || name === "default")
        ? path.join(resolvedBaseDir, "assets")
        : (agentFolder ? path.join(agentFolder, "assets") : path.join(resolvedBaseDir, "agents", name, "assets")),
      path.join(process.cwd(), "server", "src", "agents", name, "assets"),
      path.join(process.cwd(), "server", "src", "assets", "agents", name),
      path.join(process.cwd(), "server", "src", "agents", "assets"),
      path.join(process.cwd(), "server", "src", "assets")
    ];

    for (const dir of searchDirs) {
      for (const fileName of fileNames) {
        for (const ext of extensions) {
          const isAgentSpecificDir = dir.includes(name) || (agentFolder && dir.includes(agentFolder));
          const baseName = (dir.endsWith("assets") && !isAgentSpecificDir) ? name : fileName;
          const p = path.join(dir, `${baseName}${ext}`);
          try {
            await fs.access(p);
            return res.sendFile(p);
          } catch {
            // continue
          }
          if (baseName === name) break;
        }
      }
    }

    res.status(404).send("Avatar not found");
  });

  // ─── Chat SSE endpoint ──────────────────────────────────────────

  app.post("/api/chat", async (req, res) => {
    const body = req.body as Partial<ManagerRequest>;

    if (!body.event || typeof body.event.type !== "string") {
      return res.status(400).json({
        error: "The request body must contain an `event` with a string `type`.",
      });
    }

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.flushHeaders?.();

    const conversationIdRaw = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    const conversationId = normalizeConversationId(conversationIdRaw);
    if (!conversationId) {
      return res.status(400).json({ error: "conversationId is required" });
    }
    const runId = body.runId ?? `run_${generateId()}`;
    const state: ManagerState = (await loadConversationState(conversationId)) ?? {};
    state.conversationId = conversationId;
    if (!state.cwd) state.cwd = process.cwd();
    if (!state.workspaceRoot) state.workspaceRoot = process.cwd();

    const iterator = runtime.run(body.event as ManagerEvent, {
      runId,
      state,
    });

    const stopStreaming = () => {
      void iterator.return?.();
    };

    res.on("close", stopStreaming);

    try {
      for await (const chunk of iterator) {
        if (res.writableEnded) break;
        await logConversationEvent(conversationId, runId, chunk);
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      await saveConversationState(conversationId, state);
    } catch (error) {
      console.error("Melony stream error:", error);
      if (!res.writableEnded) {
        res.write(
          `event: error\ndata: ${JSON.stringify({
            message: error instanceof Error ? error.message : String(error),
          })}\n\n`
        );
      }
    } finally {
      res.off("close", stopStreaming);
      if (!res.writableEnded) {
        res.write("event: done\ndata: {}\n\n");
        res.end();
      }
    }
  });

  app.listen(PORT, () => {
    console.log(`OpenBot server listening at http://localhost:${PORT}`);
    console.log(`  - Chat endpoint: POST /api/chat`);
    console.log(`  - REST endpoints: /api/config, /api/conversations, /api/agents`);
    if (options.openaiApiKey) console.log("  - Using OpenAI API Key from CLI");
    if (options.anthropicApiKey)
      console.log("  - Using Anthropic API Key from CLI");
  });
}
