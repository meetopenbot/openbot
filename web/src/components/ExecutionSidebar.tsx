import { useMemo, useState } from "react";

type ExecutionState =
  | "RECEIVED"
  | "CLASSIFIED"
  | "PLANNED"
  | "EXECUTING"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | string;

interface ExecutionEventShape {
  type?: string;
  runId?: string;
  timestamp?: string;
  data?: {
    traceId?: string;
    state?: ExecutionState;
    currentStepId?: string;
    error?: string;
    intentType?: string;
    planSteps?: number;
  };
}

interface ExecutionSnapshot {
  state: ExecutionState;
  currentStepId?: string;
  error?: string;
  timestamp?: string;
}

interface ExecutionRun {
  traceId: string;
  runId?: string;
  intentType?: string;
  planSteps?: number;
  states: ExecutionSnapshot[];
  firstIndex: number;
  lastIndex: number;
}

const TERMINAL_STATES = new Set<ExecutionState>(["COMPLETED", "FAILED"]);

function badgeClass(state: ExecutionState): string {
  if (state === "COMPLETED") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600";
  if (state === "FAILED") return "border-red-500/40 bg-red-500/10 text-red-600";
  if (state === "WAITING_APPROVAL") return "border-amber-500/40 bg-amber-500/10 text-amber-600";
  return "border-border/60 bg-muted/40 text-muted-foreground";
}

function formatTime(value?: string): string {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function buildRuns(events: unknown[]): ExecutionRun[] {
  const map = new Map<string, ExecutionRun>();

  events.forEach((raw, index) => {
    const event = raw as ExecutionEventShape;
    if (event?.type !== "execution:state") return;

    const traceId = event.data?.traceId;
    const state = event.data?.state;
    if (!traceId || !state) return;

    const existing = map.get(traceId);
    if (!existing) {
      map.set(traceId, {
        traceId,
        runId: event.runId,
        intentType: event.data?.intentType,
        planSteps: event.data?.planSteps,
        states: [
          {
            state,
            currentStepId: event.data?.currentStepId,
            error: event.data?.error,
            timestamp: event.timestamp,
          },
        ],
        firstIndex: index,
        lastIndex: index,
      });
      return;
    }

    existing.lastIndex = index;
    existing.runId = existing.runId || event.runId;
    existing.intentType = existing.intentType || event.data?.intentType;
    existing.planSteps = existing.planSteps || event.data?.planSteps;
    existing.states.push({
      state,
      currentStepId: event.data?.currentStepId,
      error: event.data?.error,
      timestamp: event.timestamp,
    });
  });

  return [...map.values()].sort((a, b) => b.lastIndex - a.lastIndex);
}

function latestState(run: ExecutionRun): ExecutionSnapshot {
  return run.states[run.states.length - 1] ?? { state: "UNKNOWN" };
}

export function ExecutionSidebar({ events, open = true }: { events: unknown[]; open?: boolean }) {
  if (!open) return null;

  const runs = useMemo(() => buildRuns(events), [events]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  const activeRuns = runs.filter((run) => !TERMINAL_STATES.has(latestState(run).state));
  const completedRuns = runs.filter((run) => TERMINAL_STATES.has(latestState(run).state));

  const selectedRun = useMemo(() => {
    if (selectedTraceId) {
      return runs.find((run) => run.traceId === selectedTraceId) || null;
    }
    if (activeRuns.length > 0) return activeRuns[0];
    return runs[0] || null;
  }, [selectedTraceId, runs, activeRuns]);

  if (runs.length === 0) {
    return (
      <aside className="hidden xl:flex h-full w-[420px] shrink-0 flex-col border-l border-border/50 bg-muted/20">
        <div className="border-b border-border/50 px-4 py-3">
          <h2 className="text-sm font-semibold">Execution</h2>
          <p className="mt-1 text-xs text-muted-foreground">No runs yet in this session.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden xl:flex h-full w-[420px] shrink-0 flex-col border-l border-border/50 bg-muted/20">
      <div className="border-b border-border/50 px-4 py-3">
        <h2 className="text-sm font-semibold">Execution</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {activeRuns.length} active · {completedRuns.length} finished
        </p>
      </div>

      <div className="overflow-y-auto px-3 py-3">
        {activeRuns.length > 0 && (
          <section className="mb-4">
            <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Active Runs
            </div>
            <div className="space-y-1">
              {activeRuns.map((run) => {
                const current = latestState(run);
                const selected = selectedRun?.traceId === run.traceId;
                return (
                  <button
                    key={run.traceId}
                    onClick={() => setSelectedTraceId(run.traceId)}
                    className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${selected ? "border-border bg-background" : "border-transparent hover:border-border/50 hover:bg-background/70"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-medium">{run.traceId}</span>
                      <span className={`rounded-md border px-1.5 py-0.5 text-[10px] ${badgeClass(current.state)}`}>
                        {current.state}
                      </span>
                    </div>
                    {current.currentStepId && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {current.currentStepId}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {completedRuns.length > 0 && (
          <section className="mb-4">
            <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Previous Runs
            </div>
            <div className="space-y-1">
              {completedRuns.slice(0, 20).map((run) => {
                const current = latestState(run);
                const selected = selectedRun?.traceId === run.traceId;
                return (
                  <button
                    key={run.traceId}
                    onClick={() => setSelectedTraceId(run.traceId)}
                    className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${selected ? "border-border bg-background" : "border-transparent hover:border-border/50 hover:bg-background/70"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px]">{run.traceId}</span>
                      <span className={`rounded-md border px-1.5 py-0.5 text-[10px] ${badgeClass(current.state)}`}>
                        {current.state}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {selectedRun && (
          <section>
            <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Selected Run
            </div>
            <div className="rounded-xl border border-border/60 bg-background/80 p-3">
              <div className="text-[11px] font-medium">{selectedRun.traceId}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                {selectedRun.runId && <span>run: {selectedRun.runId}</span>}
                {selectedRun.intentType && <span>intent: {selectedRun.intentType}</span>}
                {typeof selectedRun.planSteps === "number" && (
                  <span>steps: {selectedRun.planSteps}</span>
                )}
              </div>

              <div className="mt-3 space-y-2">
                {selectedRun.states.map((snapshot, index) => (
                  <div key={`${selectedRun.traceId}-${index}`} className="flex items-start gap-2">
                    <div className="mt-1 flex w-3 justify-center">
                      <span className={`size-1.5 rounded-full border ${badgeClass(snapshot.state)}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-md border px-1.5 py-0.5 text-[10px] ${badgeClass(snapshot.state)}`}>
                          {snapshot.state}
                        </span>
                        {snapshot.currentStepId && (
                          <span className="text-[10px] text-muted-foreground">{snapshot.currentStepId}</span>
                        )}
                        {snapshot.timestamp && (
                          <span className="text-[10px] text-muted-foreground/80">
                            {formatTime(snapshot.timestamp)}
                          </span>
                        )}
                      </div>
                      {snapshot.error && (
                        <div className="mt-1 text-[10px] text-red-600/90">{snapshot.error}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
