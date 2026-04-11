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

  router.post('/image', async (req, res) => {
    const { name, mimeType, dataBase64 } = req.body as {
      name?: string;
      mimeType?: string;
      dataBase64?: string;
    };

    if (!mimeType || !allowedMimeTypes.has(mimeType)) {
      return res.status(400).json({ error: 'Unsupported image mime type' });
    }

    if (!dataBase64 || typeof dataBase64 !== 'string') {
      return res.status(400).json({ error: 'Image payload is required' });
    }

    const bytes = Buffer.from(dataBase64, 'base64');
    if (!bytes.length) {
      return res.status(400).json({ error: 'Invalid image payload' });
    }

    if (bytes.length > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: 'Image too large (max 8MB)' });
    }

    try {
      const ext = extensionByMimeType[mimeType] ?? '.bin';
      const now = new Date();
      const y = now.getFullYear().toString();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const datePath = path.join(y, m);
      const fileName = `${Date.now()}-${randomUUID()}${ext}`;
      const id = path.posix.join(y, m, fileName);
      const uploadsDir = getUploadsDir();
      const datedDir = path.join(uploadsDir, datePath);
      await fs.mkdir(datedDir, { recursive: true });
      await fs.writeFile(path.join(datedDir, fileName), bytes);

      const origin = `${req.protocol}://${req.get('host')}`;
      const encodedId = id.split('/').map(encodeURIComponent).join('/');
      res.json({
        id,
        name: typeof name === 'string' && name.trim() ? name.trim() : `image${ext}`,
        mimeType,
        size: bytes.length,
        url: `${origin}/api/uploads/${encodedId}`,
      });
    } catch (error) {
      console.error('Image upload failed:', error);
      res.status(500).json({ error: 'Failed to store image' });
    }
  });

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
