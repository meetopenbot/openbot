import { useMemo } from "react";

interface UsageStatsProps {
  events: any[];
}

export function UsageStats({ events }: UsageStatsProps) {
  const usageEvent = useMemo(() => {
    const eventsList = (events ?? []) as any[];
    for (let i = eventsList.length - 1; i >= 0; i -= 1) {
      const event = eventsList[i];
      if (event?.type === "usage:update" && event?.data?.scope === "manager") return event;
    }
    for (let i = eventsList.length - 1; i >= 0; i -= 1) {
      const event = eventsList[i];
      if (event?.type === "usage:update") return event;
    }
    return null;
  }, [events]);

  if (!usageEvent?.data) return null;

  const usageData = usageEvent.data;
  const usageModel = usageData.model as string | undefined;
  const turnInputTokens = Number(usageData.turn?.inputTokens ?? 0);
  const turnOutputTokens = Number(usageData.turn?.outputTokens ?? 0);
  const sessionTotalTokens = Number(usageData.session?.totalTokens ?? 0);

  const formatInt = (value: number) => new Intl.NumberFormat().format(Math.max(0, Math.floor(value)));

  return (
    <div className="group relative">
      <div
        className="rounded-md px-2 py-1 text-[11px] text-muted-foreground/80 transition-colors group-hover:bg-muted/60 group-hover:text-foreground"
        aria-label="Token usage"
      >
        {formatInt(turnInputTokens)} in / {formatInt(sessionTotalTokens)} total
      </div>
      <div className="pointer-events-none absolute bottom-[calc(100%+8px)] right-0 z-20 hidden w-[160px] rounded-lg border border-border/60 bg-background px-2.5 py-2 text-[11px] shadow-xl group-hover:block">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Last prompt</span>
          <span className="font-medium text-foreground">{formatInt(turnInputTokens)}</span>
        </div>
        <div className="mt-1 text-muted-foreground">
          Output: {formatInt(turnOutputTokens)} tokens
        </div>
        <div className="mt-1 text-muted-foreground">
          Session total: {formatInt(sessionTotalTokens)} tokens
        </div>
        {usageModel && (
          <div className="mt-1 truncate text-muted-foreground/80">
            {usageModel}
          </div>
        )}
      </div>
    </div>
  );
}
