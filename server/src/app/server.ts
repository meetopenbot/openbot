import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { generateId } from 'melony';
import { createOpenBot } from './open-bot.js';
import { loadConfig, saveConfig, isConfigured, resolvePath, DEFAULT_BASE_DIR } from './config.js';
import {
  loadConversationState,
  saveConversationState,
  logConversationEvent,
} from '../services/conversation.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { ConversationState, ConversationEvent } from './types.js';

import { startAutomationWorker } from '../services/automation-worker.js';
import { listAutomations, type AutomationRecord } from '../services/automations.js';
import { summarizeAgentEventValue } from './router.js';
import { createIndexRouter } from '../routes/index.js';
import { createModelsRouter } from '../routes/models.js';
import { createAutomationsRouter } from '../routes/automations.js';
import { createUploadsRouter } from '../routes/uploads.js';
import { createConfigRouter } from '../routes/config.js';
import { createConversationsRouter } from '../routes/conversations.js';
import { createChannelsRouter } from '../routes/channels.js';
import { createAgentsRouter } from '../routes/agents.js';
import { createRunsRouter } from '../routes/runs.js';
import type { ServerContext } from '../routes/context.js';

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

  const createRuntime = () =>
    createOpenBot({
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
      console.log('[hot-reload] Runtime reloaded from ~/.openbot changes');
    } catch (error) {
      console.error('[hot-reload] Reload failed; keeping previous runtime', error);
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
  const agentsDir = path.join(openBotDir, 'agents');
  const pluginsDir = path.join(openBotDir, 'plugins');
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
    const state: ConversationState = (await loadConversationState(conversationId)) ?? {};

    state.conversationId = conversationId;
    if (!state.cwd) state.cwd = process.cwd();
    if (!state.openbotRoot) state.openbotRoot = process.cwd();
    if (!state.title) state.title = `Automation: ${automation.name}`;

    const content =
      automation.targetType === 'agent' && automation.agentName
        ? `/${automation.agentName} ${automation.prompt}`
        : automation.prompt;

    const iterator = runtime.run(
      {
        type: 'agent:input',
        data: { content },
      },
      { runId, state },
    );

    try {
      console.log(
        `[automations] Running "${automation.name}" (${automation.id}) at ${scheduledAt.toISOString()}`,
      );
      for await (const chunk of iterator) {
        await appendConversationEvent(conversationId, runId, chunk);
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

  process.once('SIGINT', () => {
    void cleanupBackground().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void cleanupBackground().finally(() => process.exit(0));
  });

  app.use(cors());
  app.use(express.json({ limit: '20mb' }));

  const conversationSubscribers = new Map<string, Set<(event: ConversationEvent) => void>>();

  type RunJob = {
    conversationId: string;
    runId: string;
    event: ConversationEvent;
    delegation?: {
      parentDelegationId: string;
      toolCallId: string;
      leadAgentId: string;
      depth: number;
    };
  };

  const runQueue: RunJob[] = [];
  const activeRuns = new Set<string>();
  const runConversationById = new Map<string, string>();
  const runAgentsById = new Map<string, Set<string>>();
  const cancelledRuns = new Set<string>();
  let processingQueue = false;

  const subscribeConversation = (
    conversationId: string,
    listener: (event: ConversationEvent) => void,
  ) => {
    const listeners = conversationSubscribers.get(conversationId) ?? new Set();
    listeners.add(listener);
    conversationSubscribers.set(conversationId, listeners);
    return () => {
      const current = conversationSubscribers.get(conversationId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) conversationSubscribers.delete(conversationId);
    };
  };

  const appendConversationEvent = async (
    conversationId: string,
    runId: string,
    event: ConversationEvent,
  ) => {
    await logConversationEvent(conversationId, runId, event);
    const listeners = conversationSubscribers.get(conversationId);
    if (!listeners) return;
    for (const listener of listeners) listener(event);
  };

  const processRunQueue = async () => {
    if (processingQueue) return;
    processingQueue = true;
    try {
      while (runQueue.length > 0) {
        const job = runQueue.shift();
        if (!job) continue;

        const { conversationId, runId, event, delegation } = job;
        runConversationById.set(runId, conversationId);
        runAgentsById.set(runId, new Set());
        const state: ConversationState = (await loadConversationState(conversationId)) ?? {};
        state.conversationId = conversationId;
        if (!state.cwd) state.cwd = process.cwd();
        if (!state.openbotRoot) state.openbotRoot = process.cwd();

        // For delegated sub-runs, set depth to prevent infinite recursion
        if (delegation) {
          (state as any)._delegationDepth = delegation.depth;
        }

        activeRuns.add(runId);
        await appendConversationEvent(conversationId, runId, {
          type: 'run:started',
          data: { runId },
        } as ConversationEvent);

        let lastSubAgentOutput = '';
        const iterator = runtime.run(event, { runId, state });
        try {
          for await (const chunk of iterator) {
            if (cancelledRuns.has(runId)) {
              await iterator.return?.();
              break;
            }

            const agentId = chunk.meta?.agentId;
            if (typeof agentId === 'string' && agentId) {
              const activeAgents = runAgentsById.get(runId);
              activeAgents?.add(agentId);

              if (!state.participatingAgents) state.participatingAgents = [];
              if (!state.participatingAgents.includes(agentId)) {
                state.participatingAgents.push(agentId);
              }
            }

            // --- DELEGATION HANDOFF ---
            // When the lead agent delegates, queue an independent sub-run.
            if (chunk.type === 'agent:delegation') {
              const { targetAgentId, content, toolCallId, leadAgentId, depth } = chunk.data;
              if (targetAgentId && content) {
                console.log(`[delegation] Handoff: ${leadAgentId} → ${targetAgentId}`);
                runQueue.push({
                  conversationId,
                  runId: `run_delegated_${generateId()}`,
                  event: {
                    type: 'agent:input',
                    data: { content },
                    meta: { agentId: targetAgentId, delegation: true },
                  } as ConversationEvent,
                  delegation: {
                    parentDelegationId: chunk.id!,
                    toolCallId,
                    leadAgentId: leadAgentId || 'default',
                    depth: typeof depth === 'number' ? depth : 1,
                  },
                });
              }
            }

            // For delegated sub-runs, skip logging the synthetic agent:input
            // (Melony re-emits the triggering event; logging it makes UI show "You")
            if (delegation && chunk.type === 'agent:input') continue;

            // For delegated sub-runs, tag events so the UI can nest them
            if (delegation) {
              chunk.meta = {
                ...(chunk.meta || {}),
                delegationId: delegation.parentDelegationId,
              };

              // Capture the last meaningful output for the callback
              if (chunk.type === 'agent:output' || chunk.type === 'agent:output-delta') {
                const summary = summarizeAgentEventValue(chunk);
                if (summary) lastSubAgentOutput = summary;
              }
            }

            await appendConversationEvent(conversationId, runId, chunk);
          }

          await appendConversationEvent(conversationId, runId, {
            type: cancelledRuns.has(runId) ? 'run:cancelled' : 'run:finished',
            data: { runId },
          } as ConversationEvent);

          // --- DELEGATION CALLBACK ---
          // When a delegated sub-run finishes, resume the lead agent with the tool result.
          if (delegation && !cancelledRuns.has(runId)) {
            const { toolCallId, leadAgentId } = delegation;
            const feedback = lastSubAgentOutput.trim() || '(Sub-agent produced no output)';
            const MAX_FEEDBACK_LEN = 12_000;
            console.log(`[delegation] Callback: resuming ${leadAgentId} with tool result`);

            runQueue.push({
              conversationId,
              runId: `run_resume_${generateId()}`,
              event: {
                type: 'action:result',
                data: {
                  action: 'delegate',
                  toolCallId,
                  result:
                    feedback.length > MAX_FEEDBACK_LEN
                      ? feedback.slice(0, MAX_FEEDBACK_LEN) + '\n…(truncated)'
                      : feedback,
                },
                meta: { agentId: leadAgentId },
              } as ConversationEvent,
            });
          }
        } catch (error) {
          console.error('Background run failed:', error);
          await appendConversationEvent(conversationId, runId, {
            type: 'run:failed',
            data: {
              runId,
              message: error instanceof Error ? error.message : String(error),
            },
          } as ConversationEvent);
        } finally {
          activeRuns.delete(runId);
          cancelledRuns.delete(runId);
          runConversationById.delete(runId);
          runAgentsById.delete(runId);
          await saveConversationState(conversationId, state);
        }
      }
    } finally {
      processingQueue = false;
    }
  };

  const ctx: ServerContext = {
    get runtime() {
      return runtime;
    },
    resolvedBaseDir,
    scheduleReload,
    activeRuns,
    runConversationById,
    runAgentsById,
    cancelledRuns,
    runQueue,
    processRunQueue,
    appendConversationEvent,
    subscribeConversation,
    options: {
      openaiApiKey: options.openaiApiKey,
      anthropicApiKey: options.anthropicApiKey,
    },
  };

  app.use('/', createIndexRouter(ctx));
  app.use('/api', createModelsRouter(ctx));
  app.use('/api/automations', createAutomationsRouter(ctx));
  app.use('/api/uploads', createUploadsRouter(ctx));
  app.use('/api', createConfigRouter(ctx));
  app.use('/api/conversations', createConversationsRouter(ctx));
  app.use('/api/channels', createChannelsRouter(ctx));
  app.use('/api/agents', createAgentsRouter(ctx));
  app.use('/api', createRunsRouter(ctx));

  app.listen(PORT, () => {
    console.log(`\x1b[32mOpenBot server listening at http://localhost:${PORT}\x1b[0m`);
    console.log(`  - Runs endpoint: POST /api/runs`);
    console.log(`  - REST endpoints: /api/config, /api/conversations, /api/agents`);
    if (options.openaiApiKey) console.log('  - Using OpenAI API Key from CLI');
    if (options.anthropicApiKey) console.log('  - Using Anthropic API Key from CLI');
  });
}
