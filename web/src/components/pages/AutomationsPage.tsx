import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";

const EXAMPLE_CRONS = [
  "0 9 * * 1-5",
  "0 * * * *",
  "0 18 * * 1",
];

export function AutomationsPage() {
  const queryClient = useQueryClient();
  const { data: automations = [], isLoading } = useQuery({
    queryKey: ["automations"],
    queryFn: api.getAutomations,
  });

  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cron, setCron] = useState("0 9 * * 1-5");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = useMemo(
    () => Boolean(name.trim() && prompt.trim() && cron.trim()) && !saving,
    [name, prompt, cron, saving]
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["automations"] });

  const createAutomation = async () => {
    if (!canCreate) return;
    setSaving(true);
    setError(null);
    try {
      await api.createAutomation({
        name: name.trim(),
        prompt: prompt.trim(),
        cron: cron.trim(),
      });
      setName("");
      setPrompt("");
      setCron("0 9 * * 1-5");
      await refresh();
    } catch {
      setError("Failed to create automation.");
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (id: string, enabled: boolean) => {
    await api.updateAutomation(id, { enabled: !enabled });
    await refresh();
  };

  const removeAutomation = async (id: string) => {
    await api.deleteAutomation(id);
    await refresh();
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10 animate-in fade-in">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Automations</h2>
          <p className="text-[13px] text-muted-foreground/70">
            Create lightweight scheduled tasks with a cron expression and prompt.
          </p>
        </div>

        <section className="rounded-2xl border border-border/50 p-5">
          <h3 className="text-[13px] font-medium">New Automation</h3>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (e.g. Daily standup summary)"
              className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
            />
            <input
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="Cron (e.g. 0 9 * * 1-5)"
              className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
            />
            <button
              onClick={createAutomation}
              disabled={!canCreate}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Prompt to run on schedule"
            className="mt-3 min-h-24 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
          />
          <p className="mt-2 text-xs text-muted-foreground/70">
            Example crons: {EXAMPLE_CRONS.join("  |  ")}
          </p>
          {error && (
            <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
              {error}
            </p>
          )}
        </section>

        <section className="pb-8">
          <h3 className="text-[13px] font-medium">Saved Automations</h3>
          {isLoading ? (
            <p className="mt-3 text-sm text-muted-foreground/70">Loading automations...</p>
          ) : automations.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground/70">No automations yet.</p>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              {automations.map((automation) => (
                <div
                  key={automation.id}
                  className="flex h-full flex-col gap-3 rounded-xl border border-border/50 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-medium">{automation.name}</h4>
                      <p className="mt-1 text-xs font-mono text-muted-foreground/70">
                        {automation.cron}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        automation.enabled
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {automation.enabled ? "Enabled" : "Paused"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground/80">
                    {automation.prompt}
                  </p>
                  <div className="mt-auto flex gap-2">
                    <button
                      onClick={() => void toggleEnabled(automation.id, automation.enabled)}
                      className="rounded-md border border-border/60 px-3 py-1.5 text-xs hover:bg-muted/50"
                    >
                      {automation.enabled ? "Pause" : "Enable"}
                    </button>
                    <button
                      onClick={() => void removeAutomation(automation.id)}
                      className="rounded-md border border-border/60 px-3 py-1.5 text-xs text-red-500 hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
