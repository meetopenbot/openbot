import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { listAutomations, saveAutomations, type AutomationRecord } from '../services/automations.js';
import type { ServerContext } from './context.js';

export function createAutomationsRouter(_ctx: ServerContext) {
  const router = Router();

  router.get('/', async (_req, res) => {
    const items = await listAutomations();
    res.json(items);
  });

  router.post('/', async (req, res) => {
    const { name, prompt, cron, targetType, agentName } = req.body as {
      name?: string;
      prompt?: string;
      cron?: string;
      targetType?: 'orchestrator' | 'agent';
      agentName?: string;
    };

    const normalizedTargetType = targetType === 'agent' ? 'agent' : 'orchestrator';
    const normalizedAgentName = typeof agentName === 'string' ? agentName.trim() : '';

    if (
      typeof name !== 'string' ||
      typeof prompt !== 'string' ||
      typeof cron !== 'string' ||
      !name.trim() ||
      !prompt.trim() ||
      !cron.trim() ||
      (normalizedTargetType === 'agent' && !normalizedAgentName)
    ) {
      return res.status(400).json({ error: 'Invalid automation payload' });
    }

    const now = new Date().toISOString();
    const next: AutomationRecord = {
      id: `auto_${randomUUID()}`,
      name: name.trim(),
      prompt: prompt.trim(),
      cron: cron.trim(),
      targetType: normalizedTargetType,
      agentName: normalizedTargetType === 'agent' ? normalizedAgentName : undefined,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    const current = await listAutomations();
    await saveAutomations([next, ...current]);
    res.status(201).json(next);
  });

  router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, prompt, cron, enabled, targetType, agentName } = req.body as {
      name?: string;
      prompt?: string;
      cron?: string;
      enabled?: boolean;
      targetType?: 'orchestrator' | 'agent';
      agentName?: string;
    };

    const current = await listAutomations();
    const index = current.findIndex((item) => item.id === id);
    if (index < 0) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const existing = current[index];
    const nextTargetType =
      targetType === 'agent'
        ? 'agent'
        : targetType === 'orchestrator'
          ? 'orchestrator'
          : existing.targetType;
    const nextAgentName =
      typeof agentName === 'string' ? agentName.trim() : (existing.agentName ?? '');

    if (nextTargetType === 'agent' && !nextAgentName) {
      return res.status(400).json({ error: 'agentName is required when targetType is agent' });
    }

    const updated: AutomationRecord = {
      ...existing,
      name: typeof name === 'string' ? name.trim() || existing.name : existing.name,
      prompt: typeof prompt === 'string' ? prompt.trim() || existing.prompt : existing.prompt,
      cron: typeof cron === 'string' ? cron.trim() || existing.cron : existing.cron,
      targetType: nextTargetType,
      agentName: nextTargetType === 'agent' ? nextAgentName : undefined,
      enabled: typeof enabled === 'boolean' ? enabled : existing.enabled,
      updatedAt: new Date().toISOString(),
    };

    current[index] = updated;
    await saveAutomations(current);
    res.json(updated);
  });

  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const current = await listAutomations();
    const next = current.filter((item) => item.id !== id);
    if (next.length === current.length) {
      return res.status(404).json({ error: 'Automation not found' });
    }
    await saveAutomations(next);
    res.json({ success: true });
  });

  return router;
}
