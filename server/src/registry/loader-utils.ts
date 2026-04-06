import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export function toTitleCaseFromSlug(value: string): string {
  return (
    value
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || 'Agent'
  );
}

export async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

export async function findIndexFile(dir: string): Promise<string | undefined> {
  for (const file of ['dist/index.js', 'index.js', 'index.ts']) {
    if (await fileExists(path.join(dir, file))) {
      return path.join(dir, file);
    }
  }
  return undefined;
}
