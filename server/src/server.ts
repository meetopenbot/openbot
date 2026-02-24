import "dotenv/config";
import express from "express";
import cors from "cors";
import { generateId } from "melony";
import { createOpenBot } from "./open-bot.js";
import { loadConfig, saveConfig, isConfigured, resolvePath, DEFAULT_BASE_DIR } from "./config.js";
import { loadSession, saveSession, logEvent, loadEvents, listSessions } from "./session.js";
import { listYamlAgents } from "./registry/index.js";
import { exec } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { ChatEvent, ChatRequest, ChatState } from "./types.js";
import { fetchProviderModels, getModelCatalog } from "./model-catalog.js";
import type { ModelProvider } from "./model-catalog.js";
import { DEFAULT_MODEL_BY_PROVIDER, DEFAULT_MODEL_ID } from "./model-defaults.js";

export interface ServerOptions {
  port?: string | number;
  openaiApiKey?: string;
  anthropicApiKey?: string;
}

export async function startServer(options: ServerOptions = {}) {
  const config = loadConfig();
  const PORT = Number(options.port ?? config.port ?? process.env.PORT ?? 4001);
  const app = express();

  const orchestrator = await createOpenBot({
    openaiApiKey: options.openaiApiKey,
    anthropicApiKey: options.anthropicApiKey,
  });

  app.use(cors());
  app.use(express.json({ limit: "20mb" }));

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
        sessions: "GET /api/sessions",
        agents: "GET /api/agents",
        prompts: "GET /api/prompts",
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
      model: cfg.model || DEFAULT_MODEL_ID,
      defaultModelId: DEFAULT_MODEL_ID,
      defaultModels: DEFAULT_MODEL_BY_PROVIDER,
      hasOpenAIKey: !!cfg.openaiApiKey,
      hasAnthropicKey: !!cfg.anthropicApiKey,
    });
  });

  app.post("/api/config", async (req, res) => {
    const { openai_api_key, anthropic_api_key, model } = req.body;
    const updates: Record<string, string> = {};

    if (model) updates.model = model.trim();
    if (openai_api_key && openai_api_key !== "••••••••••••••••")
      updates.openaiApiKey = openai_api_key.trim();
    if (anthropic_api_key && anthropic_api_key !== "••••••••••••••••")
      updates.anthropicApiKey = anthropic_api_key.trim();

    if (Object.keys(updates).length > 0) {
      saveConfig(updates);
    }

    res.json({ success: true });
  });

  app.get("/api/sessions", async (_req, res) => {
    const sessions = await listSessions();
    res.json(sessions);
  });

  app.get("/api/sessions/:id/events", async (req, res) => {
    const events = await loadEvents(req.params.id);
    res.json(events);
  });

  app.get("/api/agents", async (_req, res) => {
    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const agentsDir = path.join(resolvedBaseDir, "agents");

    try {
      const agents = await listYamlAgents(agentsDir);
      res.json(agents);
    } catch {
      res.json([]);
    }
  });

  app.get("/api/agents/:name/yaml", async (req, res) => {
    const { name } = req.params;
    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const yamlPath = path.join(resolvedBaseDir, "agents", name, "agent.yaml");

    try {
      const content = await fs.readFile(yamlPath, "utf-8");
      res.send(content);
    } catch {
      res.status(404).send("Agent not found or has no agent.yaml");
    }
  });

  app.put("/api/agents/:name/yaml", async (req, res) => {
    const { name } = req.params;
    const { yaml } = req.body;
    
    if (!yaml || typeof yaml !== "string") {
      return res.status(400).json({ error: "YAML content is required" });
    }

    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const agentDir = path.join(resolvedBaseDir, "agents", name);
    const yamlPath = path.join(agentDir, "agent.yaml");

    try {
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(yamlPath, yaml, "utf-8");
      
      // Optionally, hot-reload openBotAgent if needed here.
      // But OpenBot runtime loads agents at startup or dynamically per request?
      // createOpenBot builds the Melony App. Since createOpenBot is called at startup:
      // openBotAgent = await createOpenBot(...) happens once.
      // Restarting server is required unless we hot-reload. We can just leave it as is 
      // and instruct the user to restart, or implement a simple hot reload. Let's stick to simple file write first.

      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to write agent.yaml" });
    }
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
    
    const extensions = [".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif"];
    const fileNames = ["avatar", "icon", "image", "logo"];
    
    const searchDirs = [
      path.join(resolvedBaseDir, "agents", name, "assets"),
      path.join(process.cwd(), "server", "src", "agents", name, "assets"),
      path.join(process.cwd(), "server", "src", "assets", "agents", name),
      path.join(process.cwd(), "server", "src", "agents", "assets"),
      path.join(process.cwd(), "server", "src", "assets")
    ];

    for (const dir of searchDirs) {
      for (const fileName of fileNames) {
        for (const ext of extensions) {
          const baseName = (dir.endsWith("assets") && !dir.includes(name)) ? name : fileName;
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
    const body = req.body as Partial<ChatRequest>;

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

    const sessionId = body.sessionId ?? "default";
    const runId = body.runId ?? `run_${generateId()}`;
    const state: ChatState = (await loadSession(sessionId)) ?? {};
    state.sessionId = sessionId;
    if (!state.cwd) state.cwd = process.cwd();
    if (!state.workspaceRoot) state.workspaceRoot = process.cwd();

    const iterator = orchestrator.run(body.event as ChatEvent, {
      runId,
      state,
    });

    const stopStreaming = () => {
      iterator.return?.({ done: true, value: undefined });
    };

    res.on("close", stopStreaming);

    try {
      for await (const chunk of iterator) {
        if (res.writableEnded) break;
        await logEvent(sessionId, runId, chunk);
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      await saveSession(sessionId, state);
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
    console.log(`  - REST endpoints: /api/config, /api/sessions, /api/agents`);
    if (options.openaiApiKey) console.log("  - Using OpenAI API Key from CLI");
    if (options.anthropicApiKey)
      console.log("  - Using Anthropic API Key from CLI");
  });
}
