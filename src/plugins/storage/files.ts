import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolvePath } from '../../app/config.js';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.zip': 'application/zip',
};

export function guessMimeType(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** Resolve a relative path under a channel cwd; rejects directory escape. */
export function resolveChannelFile(baseCwd: string, relativePath: string): string {
  const resolvedBase = resolvePath(baseCwd);
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const target = path.resolve(resolvedBase, normalized);
  if (target !== resolvedBase && !target.startsWith(resolvedBase + path.sep)) {
    throw new Error('Access denied: directory escape');
  }
  return target;
}

export async function statChannelFile(
  baseCwd: string,
  relativePath: string,
): Promise<{ abs: string; size: number }> {
  const abs = resolveChannelFile(baseCwd, relativePath);
  const stat = await fs.stat(abs);
  if (!stat.isFile()) {
    throw new Error('Not a file');
  }
  return { abs, size: stat.size };
}

export function openChannelFileStream(abs: string) {
  return createReadStream(abs);
}

export function buildWorkspaceFileUrl(args: {
  baseUrl: string;
  channelId: string;
  filePath: string;
}): string {
  const base = args.baseUrl.replace(/\/$/, '');
  const data = encodeURIComponent(JSON.stringify({ path: args.filePath }));
  const channelId = encodeURIComponent(args.channelId);
  return `${base}/api/state?channelId=${channelId}&type=${encodeURIComponent('action:storage:serve-file')}&data=${data}`;
}

export function getPublicBaseUrl(port: number, configPublicUrl?: string): string {
  const fromConfig = configPublicUrl?.trim();
  if (fromConfig) {
    return fromConfig.replace(/\/$/, '');
  }
  const fromEnv = process.env.OPENBOT_PUBLIC_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  return `http://localhost:${port}`;
}
