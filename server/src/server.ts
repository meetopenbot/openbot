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
import type { ChatEvent, ChatRequest, ChatState } from "./types.js";

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
  app.use(express.json());

  const PREDEFINED_MODELS = [
    { id: "openai/gpt-4o", label: "OpenAI GPT-4o" },
    { id: "openai/gpt-4o-mini", label: "OpenAI GPT-4o Mini" },
    { id: "openai/gpt-4o-realtime-preview", label: "OpenAI GPT-4o Realtime" },
    { id: "openai/gpt-4o-instruct", label: "OpenAI GPT-4o Instruct" },
    { id: "anthropic/claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet" },
    { id: "anthropic/claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
    { id: "anthropic/claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" },
    { id: "anthropic/claude-3-instant", label: "Claude 3 Instant" },
  ];

  // Return available models to the client. This is intentionally simple:
  // - returns a predefined list and ensures the current configured model is present
  // - later we can expand this to query provider APIs or read a registry file
  app.get("/api/models", async (_req, res) => {
    try {
      const cfg = loadConfig();
      const models = PREDEFINED_MODELS.slice();
      if (cfg.model && !models.some((m) => m.id === cfg.model)) {
        models.push({ id: cfg.model, label: cfg.model });
      }
      res.json(models);
    } catch (err) {
      console.error("Failed to load models:", err);
      res.json(PREDEFINED_MODELS);
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
      { label: "Run a shell command", icon: "terminal" },
      { label: "Explain this codebase", icon: "code" },
      { label: "Read some files", icon: "file" },
    ]);
  });

  app.get("/api/config", async (_req, res) => {
    const cfg = loadConfig();
    res.json({
      configured: isConfigured(),
      model: cfg.model || "openai/gpt-4o-mini",
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
