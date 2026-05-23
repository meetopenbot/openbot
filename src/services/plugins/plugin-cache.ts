import type { Plugin } from './types.js';

/** Resolved plugins (built-in + community); shared with registry resolution. */
export const resolvedPluginCache = new Map<string, Plugin>();

/** Community plugin ids that have already been logged as loaded once. */
export const loadedCommunityPlugins = new Set<string>();

/** Drop a single id from the in-memory resolver cache (e.g. after install/uninstall). */
export function invalidatePlugin(id: string): void {
  resolvedPluginCache.delete(id);
  loadedCommunityPlugins.delete(id);
}
