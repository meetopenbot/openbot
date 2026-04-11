import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, resolvePath, DEFAULT_BASE_DIR } from '../app/config.js';
import { listAgents } from '../registry/agent-registry.js';
import type { ListedAgent } from '../registry/agent-registry.js';

export const fileExists = async (targetPath: string) =>
  fs
    .access(targetPath)
    .then(() => true)
    .catch(() => false);

export const toTitleCaseFromSlug = (value: string) =>
  value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Agent';

export const resolveAgentFolder = async (
  agentIdOrName: string,
  resolvedBaseDir: string,
): Promise<string | null> => {
  const agentsDir = path.join(resolvedBaseDir, 'agents');
  const directFolder = path.join(agentsDir, agentIdOrName);
  if (await fileExists(path.join(directFolder, 'AGENT.md'))) {
    return directFolder;
  }

  try {
    const allAgents = await listAgents(agentsDir);
    const match = allAgents.find(
      (agent: ListedAgent) =>
        (agent.folder ? path.basename(agent.folder) : agent.id) === agentIdOrName ||
        agent.name === agentIdOrName,
    );
    return match?.folder ?? null;
  } catch {
    return null;
  }
};

export const getUploadsDir = () => {
  const cfg = loadConfig();
  const baseDir = cfg.baseDir || DEFAULT_BASE_DIR;
  const resolvedBaseDir = resolvePath(baseDir);
  return path.join(resolvedBaseDir, 'uploads');
};

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const allowedMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);
export const extensionByMimeType: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};
