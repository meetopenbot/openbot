import { useState } from 'react';
import { api } from '../../lib/api';

export function SystemSettings() {
  const [reloadAck, setReloadAck] = useState(false);

  return (
    <section className="flex flex-col gap-4 pb-20">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">System</h2>
        <p className="text-[13px] text-muted-foreground/70">
          Advanced maintenance operations.
        </p>
      </div>
      <div className="flex flex-col items-start gap-4">
        <button
          type="button"
          onClick={async () => {
            try {
              await api.reload();
              setReloadAck(true);
              setTimeout(() => setReloadAck(false), 2000);
            } catch (err) {
              console.error('Reload failed', err);
            }
          }}
          className="rounded-xl border border-border/60 px-4 py-2.5 text-[13px] font-medium text-foreground transition-all duration-150 hover:border-border hover:bg-foreground/5"
        >
          {reloadAck ? 'Reloaded' : 'Reload Runtime'}
        </button>
        <p className="text-[11px] text-muted-foreground/50">
          Reloads agents and plugins from disk. Use this if you've manually modified
          configuration files.
        </p>
      </div>
    </section>
  );
}
