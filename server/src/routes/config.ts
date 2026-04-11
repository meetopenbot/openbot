import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { loadConfig, saveConfig, isConfigured } from '../app/config.js';
import { DEFAULT_MODEL_ID, DEFAULT_MODEL_BY_PROVIDER } from '../services/model-defaults.js';
import {
  listUserVariablesPublic,
  normalizeAndSaveVariables,
  type IncomingVariableRow,
} from '../services/user-variables.js';
import type { ServerContext } from './context.js';

export function createConfigRouter(ctx: ServerContext) {
  const router = Router();

  router.get('/config', async (_req, res) => {
    const cfg = loadConfig();
    res.json({
      configured: isConfigured(),
      name: cfg.name || 'OpenBot',
      description: cfg.description || 'The main orchestrator and system settings',
      model: cfg.model || DEFAULT_MODEL_ID,
      defaultModelId: DEFAULT_MODEL_ID,
      defaultModels: DEFAULT_MODEL_BY_PROVIDER,
      hasOpenAIKey: !!cfg.openaiApiKey,
      hasAnthropicKey: !!cfg.anthropicApiKey,
    });
  });

  router.post('/config', async (req, res) => {
    const { openai_api_key, anthropic_api_key, model, name, description, image } = req.body;
    const updates: Record<string, string> = {};

    if (name) updates.name = name.trim();
    if (description) updates.description = description.trim();
    if (model) updates.model = model.trim();
    if (image !== undefined) updates.image = image.trim();
    if (openai_api_key && openai_api_key !== '••••••••••••••••')
      updates.openaiApiKey = openai_api_key.trim();
    if (anthropic_api_key && anthropic_api_key !== '••••••••••••••••')
      updates.anthropicApiKey = anthropic_api_key.trim();

    if (Object.keys(updates).length > 0) {
      saveConfig(updates);
      ctx.scheduleReload();
    }

    res.json({ success: true });
  });

  // ─── User Profile (USER.md) ──────────────────────────────────────

  router.get('/user/profile', async (_req, res) => {
    const userPath = path.join(ctx.resolvedBaseDir, 'USER.md');
    try {
      const content = await fs.readFile(userPath, 'utf-8');
      res.json({ profile: content });
    } catch {
      res.json({ profile: '' });
    }
  });

  router.put('/user/profile', async (req, res) => {
    const { profile } = req.body as { profile?: string };
    if (typeof profile !== 'string') {
      return res.status(400).json({ error: 'profile content is required' });
    }

    const userPath = path.join(ctx.resolvedBaseDir, 'USER.md');
    try {
      await fs.mkdir(ctx.resolvedBaseDir, { recursive: true });
      await fs.writeFile(userPath, profile, 'utf-8');
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to save USER.md:', error);
      res.status(500).json({ error: 'Failed to save user profile' });
    }
  });

  router.get('/variables', async (_req, res) => {
    res.json({ variables: listUserVariablesPublic() });
  });

  router.put('/variables', async (req, res) => {
    const raw = req.body?.variables;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ error: 'Expected { variables: [...] }' });
    }
    const rows: IncomingVariableRow[] = raw.map((row: IncomingVariableRow) => ({
      key: typeof row?.key === 'string' ? row.key : '',
      secret: !!row?.secret,
      value: typeof row?.value === 'string' ? row.value : '',
    }));
    const result = normalizeAndSaveVariables(rows);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    ctx.scheduleReload();
    res.json({ success: true });
  });

  return router;
}
