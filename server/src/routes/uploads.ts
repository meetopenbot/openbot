import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  allowedMimeTypes,
  MAX_IMAGE_BYTES,
  extensionByMimeType,
  getUploadsDir,
} from './utils.js';
import type { ServerContext } from './context.js';

export function createUploadsRouter(_ctx: ServerContext) {
  const router = Router();

  router.get('/*', async (req, res) => {
    const rawPath = (req.params as any)[0];
    if (!rawPath || rawPath.includes('\\')) {
      return res.status(400).send('Invalid upload id');
    }

    const normalized = path.posix.normalize(rawPath);
    if (normalized.startsWith('../') || normalized === '..') {
      return res.status(400).send('Invalid upload id');
    }

    const uploadsDir = getUploadsDir();
    const filePath = path.join(uploadsDir, normalized);

    try {
      await fs.access(filePath);
      res.sendFile(filePath);
    } catch {
      res.status(404).send('Upload not found');
    }
  });

  return router;
}
