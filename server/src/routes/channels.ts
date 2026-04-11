import { Router } from 'express';
import {
  createChannelConversation,
  deleteChannelConversation,
  loadChannelSpec,
  saveChannelSpec,
  normalizeConversationId,
} from '../services/conversation.js';
import type { ServerContext } from './context.js';

export function createChannelsRouter(_ctx: ServerContext) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { name } = req.body as { name?: string };
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Channel name is required' });
    }

    try {
      const channel = await createChannelConversation(name);
      return res.status(201).json({ success: true, channel });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create channel';
      if (message === 'Channel already exists') {
        return res.status(409).json({ error: message });
      }
      if (message === 'Invalid channel name' || message === 'Channel name is required') {
        return res.status(400).json({ error: message });
      }
      console.error(error);
      return res.status(500).json({ error: 'Failed to create channel' });
    }
  });

  router.delete('/:id', async (req, res) => {
    const id = normalizeConversationId(req.params.id);

    const deleted = await deleteChannelConversation(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    return res.json({ success: true });
  });

  router.get('/:id/spec', async (req, res) => {
    const id = normalizeConversationId(req.params.id);
    const spec = await loadChannelSpec(id);
    if (spec === null) {
      return res.status(404).json({ error: 'Spec not found' });
    }
    res.json({ spec });
  });

  router.put('/:id/spec', async (req, res) => {
    const id = normalizeConversationId(req.params.id);
    const { spec } = req.body as { spec?: string };
    if (typeof spec !== 'string') {
      return res.status(400).json({ error: 'spec content is required' });
    }

    try {
      await saveChannelSpec(id, spec);
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to save spec' });
    }
  });

  return router;
}
