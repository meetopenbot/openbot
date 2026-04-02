import { useChat } from "../hooks/use-chat";
import { useMemo } from "react";
import { WidgetRenderer, type UIBlock } from "./WidgetRenderer";

export function SessionStateSidebar({ onClose }: { onClose?: () => void }) {
  const { messages, streamingMap, events } = useChat();
  const isAnyRunActive = useMemo(
    () => Object.values(streamingMap).some(Boolean),
    [streamingMap],
  );

  // Aggregate widgets from all messages
  const sidebarWidgets = useMemo(() => {
    const widgets: Record<string, UIBlock> = {};

    // Scan all events in all messages
    messages.forEach(msg => {
      const content = Array.isArray(msg.content) ? msg.content : [];

      content.forEach((event: any) => {
        // Handle explicit sidebar widgets
        if (event.type === "ui" && event.data?.placement === "sidebar") {
          const block = event.data as UIBlock;
          // Use ID if provided, otherwise widget type as key for singleton behavior
          const key = block.id || block.widget;
          widgets[key] = block;
        }
      });
    });

    return Object.values(widgets);
  }, [messages]);

  const recentEventTypes = useMemo(() => {
    return events
      .slice(-8)
      .map((event: any) => event?.type)
      .filter((type): type is string => typeof type === "string");
  }, [events]);

  const conversationStateJson = useMemo(() => {
    try {
      return JSON.stringify(
        {
          streamingMap,
          sidebarWidgets,
          messages,
          events,
        },
        null,
        2,
      );
    } catch {
      return "{}";
    }
  }, [streamingMap, sidebarWidgets, messages, events]);

  if (sidebarWidgets.length === 0) {
    return (
      <div className="flex h-full flex-col bg-background">
        <div className="sticky top-0 z-10 border-b border-border/50 bg-background/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Conversation state</h2>
              <p className="mt-1 text-xs text-muted-foreground">Artifacts and structured outputs appear here</p>
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Close conversation state panel"
                title="Close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="rounded-lg border border-border/50 bg-muted/10 p-4 text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/60">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-foreground/80">No artifacts yet</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Agents have not emitted sidebar widgets in this conversation yet.
            </p>
          </div>

          {isAnyRunActive && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-1.5 text-[11px] text-muted-foreground">
              <span className="size-2 rounded-full bg-primary animate-pulse" />
              Agent is working...
            </div>
          )}

          {recentEventTypes.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Recent events
              </p>
              <div className="flex flex-wrap gap-1.5">
                {recentEventTypes.map((type, idx) => (
                  <span
                    key={`${type}-${idx}`}
                    className="rounded-md border border-border/60 bg-background px-2 py-1 text-[10px] text-muted-foreground"
                  >
                    {type}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Conversation state JSON
            </p>
            <pre className="max-h-64 overflow-auto rounded-lg border border-border/60 bg-muted/20 p-3 text-[10px] leading-relaxed text-muted-foreground">
              {conversationStateJson}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="sticky top-0 z-10 border-b border-border/50 bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Conversation state</h2>
            <p className="mt-1 text-xs text-muted-foreground">Live artifacts and widget outputs</p>
          </div>
          <div className="flex items-center gap-2">
            {isAnyRunActive && (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                Working
              </div>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Close conversation state panel"
                title="Close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        {sidebarWidgets.map((block, idx) => (
          <div key={block.id || idx} className="animate-fade-in">
            <WidgetRenderer block={block} />
          </div>
        ))}
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Conversation state JSON
          </p>
          <pre className="max-h-64 overflow-auto rounded-lg border border-border/60 bg-muted/20 p-3 text-[10px] leading-relaxed text-muted-foreground">
            {conversationStateJson}
          </pre>
        </div>
      </div>
    </div>
  );
}
