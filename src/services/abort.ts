/**
 * Tracks in-flight agent runs so they can be cancelled.
 *
 * Runs are grouped by `channelId:threadId`. Delegated sub-agents run in the
 * same channel/thread as their parent, so aborting that key stops the whole
 * chain (parent + any delegated runs) in one shot.
 */

export const abortKey = (channelId: string, threadId?: string): string =>
  `${channelId}:${threadId || ''}`;

class AbortRegistry {
  private entries = new Map<string, { controller: AbortController; refs: number }>();

  /** Register interest in a run. Returns a shared signal for the key. */
  acquire(key: string): AbortSignal {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { controller: new AbortController(), refs: 0 };
      this.entries.set(key, entry);
    }
    entry.refs += 1;
    return entry.controller.signal;
  }

  /** Release interest. Removes the entry once no runs reference it. */
  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.refs -= 1;
    if (entry.refs <= 0) {
      this.entries.delete(key);
    }
  }

  /** Abort all runs for the key. Returns true if something was active. */
  abort(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    entry.controller.abort();
    this.entries.delete(key);
    return true;
  }
}

export const abortRegistry = new AbortRegistry();
