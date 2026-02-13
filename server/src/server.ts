import "dotenv/config";
import express from "express";
import cors from "cors";
import { generateId } from "melony";
import { createOpenBot } from "./open-bot.js";
import { loadConfig } from "./config.js";
import { loadSession, saveSession, logEvent, loadEvents } from "./session.js";
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

  // Initialize the agent instance once at startup
  const openBotAgent = await createOpenBot({
    openaiApiKey: options.openaiApiKey,
    anthropicApiKey: options.anthropicApiKey,
  });

  app.use(cors());
  app.use(express.json());

  app.get("/", async (req, res) => {
    res.json({
      message: "Melony Express demo server",
      chatEndpoint: "/api/chat",
      stream: "Server-Sent Events (SSE)",
    });
  });

  // View endpoint (GET version of chat, returns JSON instead of SSE)
  app.get("/api/view", async (req, res) => {
    const { type = "init", data: dataStr } = req.query;

    // Parse the structured data
    const eventData = dataStr ? JSON.parse(dataStr as string) : {};
    const { sessionId = "default", history = false } = eventData;

    const state: ChatState = (await loadSession(sessionId as string)) ?? {};
    state.sessionId = sessionId as string;

    const response = await openBotAgent.jsonResponse(
      {
        type: type as string,
        data: eventData,
      } as any,
      {
        state,
        runId: generateId(),
      }
    );

    const result = await response.json();

    const uiEvents = result.events.filter(
      (event: { type: string; meta: { type: string } }) =>
        event.type === "ui"
    );

    const layout = uiEvents.find((e: any) => e.meta?.type === "layout")?.data;
    const sidebar = uiEvents.find((e: any) => e.meta?.type === "sidebar")?.data;
    const content = uiEvents.find((e: any) => e.meta?.type === "content")?.data;

    const initialEvents = history ? await loadEvents(sessionId as string) : undefined;

    res.json({
      ui: layout,
      sidebar,
      content,
      initialEvents,
    });

  });

  // Chat endpoint
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

    const runtime = openBotAgent.build();

    const sessionId = body.sessionId ?? "default";
    const runId = body.runId ?? `run_${generateId()}`;
    const state: ChatState = (await loadSession(sessionId)) ?? {};
    state.sessionId = sessionId;

    const iterator = runtime.run(body.event as ChatEvent, {
      runId,
      state,
    });

    const stopStreaming = () => {
      iterator.return?.({ done: true, value: undefined });
    };

    res.on("close", stopStreaming);

    try {
      for await (const chunk of iterator) {
        if (res.writableEnded) {
          break;
        }
        // Log each event to the persistent file
        await logEvent(sessionId, runId, chunk);
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      // After the run finishes, save the final state back to disk
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
    if (options.openaiApiKey) console.log("  - Using OpenAI API Key from CLI");
    if (options.anthropicApiKey)
      console.log("  - Using Anthropic API Key from CLI");
  });
}
