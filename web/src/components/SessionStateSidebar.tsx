import { useChat } from "../hooks/use-chat";
import { useMemo } from "react";
import { WidgetRenderer, type UIBlock } from "./WidgetRenderer";

export function SessionStateSidebar() {
  const { messages } = useChat();

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

  if (sidebarWidgets.length === 0) {
    return (
      <aside className="hidden xl:flex h-full w-[480px] shrink-0 flex-col border-l border-border/50 bg-muted/20">
        <div className="px-4 py-6 text-center">
          <div className="size-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/50">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-foreground/70">No session data</h3>
          <p className="text-xs text-muted-foreground/50 mt-1 px-4">
            Structured results and widgets from agents will appear here.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden xl:flex h-full w-[480px] shrink-0 flex-col border-l border-border/50 bg-muted/5 backdrop-blur-sm">
      <div className="border-b border-border/50 px-5 py-4 bg-background/50 backdrop-blur-md sticky top-0 z-10">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.15em] text-foreground/40 flex items-center gap-2.5">
          <span className="size-1.5 rounded-full bg-primary/40 animate-pulse" />
          Session Insights
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-8 scrollbar-hide">
        {sidebarWidgets.map((block, idx) => (
          <div key={block.id || idx} className="animate-fade-in">
            <WidgetRenderer block={block} />
          </div>
        ))}
      </div>
    </aside>
  );
}
