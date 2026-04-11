import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import matter from 'gray-matter';
import { loadConfig, saveConfig, DEFAULT_BASE_DIR, resolvePath } from '../app/config.js';
import { listAgents, listToolPlugins } from '../registry/agent-registry.js';
import type { ListedToolPlugin } from '../registry/agent-registry.js';
import { readAgentConfig } from '../registry/agent-loader.js';
import { getMarketplaceRegistry, installMarketplacePlugin } from '../services/marketplace.js';
import {
  toTitleCaseFromSlug,
  resolveAgentFolder,
  resolveLocalAgentAvatarFilePath,
} from './utils.js';
import type { ServerContext } from './context.js';

function resolveAgentListImageUrl(
  origin: string,
  routeKey: string,
  candidate: string | undefined,
  hasLocalAvatar: boolean,
): string | undefined {
  const t = typeof candidate === 'string' ? candidate.trim() : '';
  if (t.startsWith('http://') || t.startsWith('https://')) return t;
  if (hasLocalAvatar) {
    return `${origin}/api/agents/${encodeURIComponent(routeKey)}/avatar`;
  }
  return t || undefined;
}

export function createAgentsRouter(ctx: ServerContext) {
  const router = Router();

  router.get('/', async (req, res) => {
    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const agentsDir = path.join(resolvedBaseDir, 'agents');

    const defaultName = cfg.name || 'OpenBot';
    const defaultDescription = cfg.description || 'The main orchestrator and system settings';

    const agents: any[] = [
      {
        id: 'default',
        name: defaultName,
        description: defaultDescription,
        folder: resolvedBaseDir,
        isDefault: true,
        hasAgentMd: true,
        image: cfg.image,
      },
    ];
    const seenIds = new Set<string>(['default']);

    try {
      const discoveredAgents = await listAgents(agentsDir);
      for (const agent of discoveredAgents) {
        const id = agent.folder ? path.basename(agent.folder) : agent.id;
        if (seenIds.has(id)) continue;
        const hasUnnamedDisplayName = /^Unnamed\s+(Plugin|Tool|Agent)$/i.test(agent.name);
        agents.push({
          ...agent,
          id,
          name: hasUnnamedDisplayName ? toTitleCaseFromSlug(id) : agent.name,
          hasAgentMd: true,
        });
        seenIds.add(id);
      }
    } catch {
      // ignore
    }

    // Agents registered in the runtime (built-ins, ~/.openbot/plugins, etc.) not already listed from agents/
    const registryAgents = ctx.runtime.registry
      .getAgents()
      .filter((entry: any) => !seenIds.has(entry.id))
      .sort((a: any, b: any) => a.id.localeCompare(b.id));
    for (const entry of registryAgents) {
      const hasUnnamedDisplayName = /^Unnamed\s+(Plugin|Tool|Agent)$/i.test(entry.name);
      agents.push({
        id: entry.id,
        name: hasUnnamedDisplayName ? toTitleCaseFromSlug(entry.id) : entry.name,
        description: entry.description,
        type: 'agent' as const,
        folder: entry.folder,
        isBuiltIn: entry.isBuiltIn === true,
        hasAgentMd: false,
      });
      seenIds.add(entry.id);
    }

    const origin = `${req.protocol}://${req.get('host')}`;
    const enriched = await Promise.all(
      agents.map(async (a: (typeof agents)[number]) => {
        const routeKey = a.isDefault ? 'default' : a.id;
        const hasLocalAvatar = !!(await resolveLocalAgentAvatarFilePath(
          routeKey,
          resolvedBaseDir,
          defaultName,
        ));
        return {
          ...a,
          image: resolveAgentListImageUrl(origin, routeKey, a.image, hasLocalAvatar),
        };
      }),
    );

    res.json(enriched);
  });

  router.post('/', async (req, res) => {
    const body = req.body as {
      id?: string;
      name?: string;
      description?: string;
      model?: string;
      runtime?: string | { name: string; config?: unknown };
      image?: string;
      plugins?: Array<string | { name: string; config?: unknown }>;
      subscribe?: string[];
      md?: string;
    };

    const normalizedId = (body.id || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-_]*$/.test(normalizedId)) {
      return res.status(400).json({
        error: 'Invalid agent id. Use lowercase letters, numbers, dashes, and underscores.',
      });
    }

    const normalizedName = (body.name || '').trim();
    const normalizedDescription = (body.description || '').trim();
    if (!normalizedName || !normalizedDescription) {
      return res.status(400).json({ error: 'name and description are required' });
    }

    const normalizedPlugins: Array<string | { name: string; config?: unknown }> = [];
    for (const plugin of body.plugins || []) {
      if (typeof plugin === 'string') {
        const normalized = plugin.trim();
        if (normalized) normalizedPlugins.push(normalized);
        continue;
      }
      if (!plugin || typeof plugin !== 'object' || typeof plugin.name !== 'string') continue;
      const normalizedName = plugin.name.trim();
      if (!normalizedName) continue;
      if (typeof plugin.config === 'undefined') normalizedPlugins.push({ name: normalizedName });
      else normalizedPlugins.push({ name: normalizedName, config: plugin.config });
    }

    const normalizedSubscribe = Array.isArray(body.subscribe)
      ? body.subscribe
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
    const normalizedRuntime =
      typeof body.runtime === 'string'
        ? body.runtime.trim() || 'llm'
        : body.runtime &&
            typeof body.runtime === 'object' &&
            typeof body.runtime.name === 'string' &&
            body.runtime.name.trim()
          ? {
              name: body.runtime.name.trim(),
              ...(typeof body.runtime.config === 'undefined'
                ? {}
                : { config: body.runtime.config }),
            }
          : 'llm';

    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const agentDir = path.join(resolvedBaseDir, 'agents', normalizedId);
    const mdPath = path.join(agentDir, 'AGENT.md');

    try {
      await fs.access(agentDir);
      return res.status(409).json({ error: `Agent "${normalizedId}" already exists` });
    } catch {
      // expected for new agent
    }

    const frontmatter: Record<string, unknown> = {
      name: normalizedName,
      description: normalizedDescription,
      runtime: normalizedRuntime,
      plugins: normalizedPlugins,
    };
    if (typeof body.model === 'string' && body.model.trim()) frontmatter.model = body.model.trim();
    if (typeof body.image === 'string' && body.image.trim()) frontmatter.image = body.image.trim();
    if (normalizedSubscribe.length > 0) frontmatter.subscribe = normalizedSubscribe;

    try {
      await fs.mkdir(agentDir, { recursive: true });
      const content = matter.stringify((body.md || '').trim(), frontmatter);
      await fs.writeFile(mdPath, content, 'utf-8');
      ctx.scheduleReload();
      res.status(201).json({ success: true, id: normalizedId });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to create agent' });
    }
  });

  router.get('/plugins', async (_req, res) => {
    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const pluginsDir = path.join(resolvedBaseDir, 'plugins');

    try {
      const toolPlugins = await listToolPlugins(pluginsDir);
      res.json(
        toolPlugins.map((plugin: ListedToolPlugin) => {
          const id = plugin.folder ? path.basename(plugin.folder) : plugin.id;
          const hasUnnamedDisplayName = /^Unnamed\s+(Plugin|Tool|Agent)$/i.test(plugin.name);
          return {
            ...plugin,
            id,
            name: hasUnnamedDisplayName ? toTitleCaseFromSlug(id) : plugin.name,
          };
        }),
      );
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to list plugins' });
    }
  });

  router.get('/registry/plugins', async (_req, res) => {
    try {
      const tools = ctx.runtime.registry.getTools();
      res.json(
        tools.map((t: any) => ({
          name: t.name,
          description: t.description,
          isBuiltIn: !!t.isBuiltIn,
        })),
      );
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to list registry plugins' });
    }
  });

  router.get('/marketplace/plugins', async (_req, res) => {
    try {
      const registry = await getMarketplaceRegistry();
      res.json(registry.plugins);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to load marketplace plugins' });
    }
  });

  router.post('/marketplace/install-plugin', async (req, res) => {
    const { id } = req.body as { id?: string };
    if (typeof id !== 'string' || !id.trim()) {
      return res.status(400).json({ error: 'Marketplace plugin id is required' });
    }
    try {
      const result = await installMarketplacePlugin(id.trim());
      ctx.scheduleReload();
      res.json({
        success: true,
        installedName: result.installedName,
        item: result.plugin,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to install plugin',
      });
    }
  });

  router.get('/:agentId/md', async (req, res) => {
    const { agentId } = req.params;
    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const defaultName = cfg.name || 'OpenBot';

    let mdPath: string;
    if (agentId === defaultName || agentId === 'default') {
      mdPath = path.join(resolvedBaseDir, 'AGENT.md');
    } else {
      const pluginFolder = await resolveAgentFolder(agentId, resolvedBaseDir);
      if (!pluginFolder) {
        return res.status(404).send('');
      }
      mdPath = path.join(pluginFolder, 'AGENT.md');
    }

    try {
      const content = await fs.readFile(mdPath, 'utf-8');
      const { content: body } = matter(content);
      res.send(body.trim());
    } catch {
      res.status(404).send('');
    }
  });

  router.put('/:agentId/md', async (req, res) => {
    const { agentId } = req.params;
    const { md } = req.body;
    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const defaultName = cfg.name || 'OpenBot';

    let mdPath: string;
    let pluginDir: string;
    if (agentId === defaultName || agentId === 'default') {
      pluginDir = resolvedBaseDir;
      mdPath = path.join(resolvedBaseDir, 'AGENT.md');
    } else {
      const pluginFolder = await resolveAgentFolder(agentId, resolvedBaseDir);
      if (!pluginFolder) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      pluginDir = pluginFolder;
      mdPath = path.join(pluginDir, 'AGENT.md');
    }

    try {
      await fs.mkdir(pluginDir, { recursive: true });

      let frontmatter = {};
      try {
        const currentContent = await fs.readFile(mdPath, 'utf-8');
        const parsed = matter(currentContent);
        frontmatter = parsed.data || {};
      } catch {
        // No current AGENT.md, starting with empty frontmatter or defaults
      }

      const consolidated = matter.stringify(md, frontmatter);
      await fs.writeFile(mdPath, consolidated, 'utf-8');
      ctx.scheduleReload();
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to write AGENT.md' });
    }
  });

  router.get('/:agentId/config', async (req, res) => {
    const { agentId } = req.params;
    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const defaultName = cfg.name || 'OpenBot';

    let mdPath: string;
    if (agentId === defaultName || agentId === 'default') {
      mdPath = path.join(resolvedBaseDir, 'AGENT.md');
    } else {
      const pluginFolder = await resolveAgentFolder(agentId, resolvedBaseDir);
      if (!pluginFolder) {
        return res.status(404).json({ error: 'Agent not found or invalid format' });
      }
      mdPath = path.join(pluginFolder, 'AGENT.md');
    }

    try {
      const content = await fs.readFile(mdPath, 'utf-8');
      const { data: parsed } = matter(content);

      if (!parsed || typeof parsed !== 'object') {
        return res.status(400).json({ error: 'Invalid AGENT.md frontmatter' });
      }

      res.json({
        name:
          typeof parsed.name === 'string'
            ? parsed.name
            : agentId === defaultName || agentId === 'default'
              ? defaultName
              : '',
        description:
          typeof parsed.description === 'string'
            ? parsed.description
            : agentId === defaultName || agentId === 'default'
              ? cfg.description || ''
              : '',
        model:
          typeof parsed.model === 'string'
            ? parsed.model
            : agentId === defaultName || agentId === 'default'
              ? cfg.model
              : undefined,
        image:
          typeof parsed.image === 'string'
            ? parsed.image
            : agentId === defaultName || agentId === 'default'
              ? cfg.image
              : undefined,
        plugins: Array.isArray(parsed.plugins) ? parsed.plugins : [],
        runtime:
          typeof parsed.runtime === 'string'
            ? parsed.runtime
            : parsed.runtime &&
                typeof parsed.runtime === 'object' &&
                typeof (parsed.runtime as Record<string, unknown>).name === 'string'
              ? parsed.runtime
              : 'llm',
        subscribe: Array.isArray(parsed.subscribe)
          ? parsed.subscribe.filter((item: unknown) => typeof item === 'string')
          : [],
      });
    } catch {
      if (agentId === defaultName || agentId === 'default') {
        // Fallback for default agent if AGENT.md is missing or unreadable
        return res.json({
          name: defaultName,
          description: cfg.description || '',
          model: cfg.model,
          image: cfg.image,
          runtime: 'llm',
          plugins: [],
          systemPrompt: '',
          subscribe: [],
        });
      }
      res.status(404).json({ error: 'Agent not found or invalid format' });
    }
  });

  router.put('/:agentId/config', async (req, res) => {
    const { agentId } = req.params;
    const body = req.body as {
      name?: string;
      description?: string;
      model?: string;
      runtime?: string | { name: string; config?: unknown };
      image?: string;
      plugins?: Array<string | { name: string; config?: unknown }>;
      subscribe?: string[];
    };

    if (
      typeof body.name !== 'string' ||
      typeof body.description !== 'string' ||
      !Array.isArray(body.plugins)
    ) {
      return res.status(400).json({ error: 'Invalid agent config payload' });
    }

    const normalizedPlugins: Array<string | { name: string; config?: unknown }> = [];
    for (const plugin of body.plugins) {
      if (typeof plugin === 'string') {
        const normalized = plugin.trim();
        if (normalized) normalizedPlugins.push(normalized);
        continue;
      }

      if (!plugin || typeof plugin !== 'object' || typeof plugin.name !== 'string') {
        continue;
      }

      const normalizedName = plugin.name.trim();
      if (!normalizedName) continue;

      if (typeof plugin.config === 'undefined') {
        normalizedPlugins.push({ name: normalizedName });
      } else {
        normalizedPlugins.push({ name: normalizedName, config: plugin.config });
      }
    }

    const normalizedName = body.name.trim();
    const normalizedDescription = body.description.trim();
    const normalizedRuntime =
      typeof body.runtime === 'string'
        ? body.runtime.trim() || 'llm'
        : body.runtime &&
            typeof body.runtime === 'object' &&
            typeof body.runtime.name === 'string' &&
            body.runtime.name.trim()
          ? {
              name: body.runtime.name.trim(),
              ...(typeof body.runtime.config === 'undefined'
                ? {}
                : { config: body.runtime.config }),
            }
          : 'llm';

    if (!normalizedName || !normalizedDescription) {
      return res.status(400).json({ error: 'name and description are required' });
    }

    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const defaultName = cfg.name || 'OpenBot';

    let pluginDir: string;
    let mdPath: string;
    if (agentId === defaultName || agentId === 'default') {
      pluginDir = resolvedBaseDir;
      mdPath = path.join(resolvedBaseDir, 'AGENT.md');
    } else {
      const pluginFolder = await resolveAgentFolder(agentId, resolvedBaseDir);
      if (!pluginFolder) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      pluginDir = pluginFolder;
      mdPath = path.join(pluginDir, 'AGENT.md');
    }

    // Read current content to preserve the body (instructions)
    let currentBody = '';
    try {
      const currentContent = await fs.readFile(mdPath, 'utf-8');
      const parsed = matter(currentContent);
      currentBody = parsed.content;
    } catch {
      // No current AGENT.md, starting with empty body or defaults
    }

    // Prepare frontmatter
    const frontmatter: Record<string, unknown> = {
      name: normalizedName,
      description: normalizedDescription,
      runtime: normalizedRuntime,
      plugins: normalizedPlugins,
    };

    if (typeof body.model === 'string' && body.model.trim()) {
      frontmatter.model = body.model.trim();
    }

    if (typeof body.image === 'string' && body.image.trim()) {
      frontmatter.image = body.image.trim();
    }

    if (Array.isArray(body.subscribe) && body.subscribe.length > 0) {
      const normalizedSubscribe = body.subscribe
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
      if (normalizedSubscribe.length > 0) {
        frontmatter.subscribe = normalizedSubscribe;
      }
    }

    try {
      await fs.mkdir(pluginDir, { recursive: true });

      const consolidated = matter.stringify(currentBody, frontmatter);
      await fs.writeFile(mdPath, consolidated, 'utf-8');

      if (agentId === defaultName || agentId === 'default') {
        // For the default agent, sync changes back to config.json
        saveConfig({
          name: normalizedName,
          description: normalizedDescription,
          model:
            typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined,
        });
      }

      ctx.scheduleReload();
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to write AGENT.md' });
    }
  });

  router.get('/:name/avatar', async (req, res) => {
    const { name } = req.params;
    const cfg = loadConfig();
    const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
    const resolvedBaseDir = resolvePath(baseDir);
    const defaultName = cfg.name || 'OpenBot';

    // 1. Resolve agent folder
    let agentFolder: string | null = null;
    if (name === defaultName || name === 'default') {
      agentFolder = resolvedBaseDir;
    } else {
      agentFolder = await resolveAgentFolder(name, resolvedBaseDir);
    }

    // 2. Check for remote image in AGENT.md if folder exists
    if (agentFolder) {
      try {
        const { image } = await readAgentConfig(agentFolder);
        if (image && (image.startsWith('http://') || image.startsWith('https://'))) {
          return res.redirect(image);
        }
      } catch {
        // ignore
      }
    }

    const localPath = await resolveLocalAgentAvatarFilePath(name, resolvedBaseDir, defaultName);
    if (localPath) {
      return res.sendFile(localPath);
    }

    res.status(404).send('Avatar not found');
  });

  return router;
}
