import { Router } from 'express';
import type { ServerContext } from './context.js';

export function createIndexRouter(_ctx: ServerContext) {
  const router = Router();

  router.get('/', async (_req, res) => {
    res.json({
      message: 'OpenBot API server',
      version: '2.0',
      endpoints: {
        runs: 'POST /api/runs',
        stream: 'GET /api/conversations/:id/stream',
        config: 'GET|POST /api/config',
        conversations: 'GET /api/conversations',
        agents: 'GET|POST /api/agents',
        prompts: 'GET /api/prompts',
        version: 'GET /api/version',
      },
    });
  });

  router.get('/prompts', async (_req, res) => {
    res.json([
      { label: 'Who are you?', icon: 'user' },
      { label: 'Who am I?', icon: 'help-circle' },
      { label: 'How can you help me?', icon: 'sparkles' },
      { label: 'What is the weather in Tokyo?', icon: 'sun' },
    ]);
  });

  return router;
}
