import { Router } from 'express';
import { fetchProviderModels, getModelCatalog } from '../services/model-catalog.js';
import type { ModelProvider } from '../services/model-catalog.js';
import { getVersionStatus } from '../app/version.js';
import type { ServerContext } from './context.js';

export function createModelsRouter(_ctx: ServerContext) {
  const router = Router();

  // Return available models to the client.
  // It prefers fresh provider APIs and falls back to bundled defaults.
  router.get('/models', async (_req, res) => {
    try {
      const models = await getModelCatalog();
      res.json(models);
    } catch (err) {
      console.error('Failed to load models:', err);
      res.json([]);
    }
  });

  router.get('/version', async (_req, res) => {
    try {
      const status = await getVersionStatus();
      res.json(status);
    } catch (err) {
      console.error('Failed to check version:', err);
      res.status(500).json({ error: 'Failed to check version' });
    }
  });

  router.post('/models/preview', async (req, res) => {
    const { provider, apiKey } = req.body as {
      provider?: string;
      apiKey?: string;
    };

    if (provider !== 'openai' && provider !== 'anthropic') {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return res.status(400).json({ error: 'API key is required' });
    }

    try {
      const models = await fetchProviderModels(provider as ModelProvider, apiKey.trim());
      res.json(models);
    } catch (err) {
      console.error('Failed to preview models:', err);
      res.status(502).json({ error: 'Failed to fetch models from provider' });
    }
  });

  return router;
}
