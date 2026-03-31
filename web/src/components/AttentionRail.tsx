import { useChat } from "../hooks/use-chat";
import { useMemo, useState } from "react";
import { WidgetRenderer, type UIBlock } from "./WidgetRenderer";
import { cn } from "../lib/utils";

type AttentionEntry = {
  key: string;
  block: UIBlock;
  eventMeta?: Record<string, any>;
};

export function AttentionRail() {
  const { messages } = useChat();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const attentionWidgets = useMemo(() => {
    const widgets: Record<string, AttentionEntry> = {};
    const approvedAttentionIds = new Set<string>();

    messages.forEach(msg => {
      const content = Array.isArray(msg.content) ? msg.content : [];

      content.forEach((event: any) => {
        if (event.type === "action:approve" || event.type === "action:deny") {
          const approvedId = event?.data?.id;
          if (typeof approvedId === "string") {
            approvedAttentionIds.add(approvedId);
            delete widgets[approvedId];
          }
          return;
        }

        if (event.type === "ui" && event.data?.placement === "attention") {
          const block = event.data as UIBlock;
          const isSuccessStatus =
            block.widget === "status" && block.props?.severity === "success";
          if (isSuccessStatus) return;
          const key = block.id || block.widget;
          if (block.widget === "approval-card" && approvedAttentionIds.has(key)) return;
          widgets[key] = { key, block, eventMeta: event.meta };
        }
      });
    });

    return Object.values(widgets);
  }, [messages]);

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (attentionWidgets.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 w-full bg-background p-2 rounded-xl border border-border/40 animate-fade-in mb-2 max-h-[50vh] overflow-y-auto pr-1 scrollbar-thin">
      {attentionWidgets.map((entry, idx) => {
        const id = entry.key || `idx-${idx}`;
        const isExpanded = expandedIds.has(id);
        const isMinimized = !isExpanded;
        const block = entry.block as UIBlock & { meta?: { title?: string } };
        
        return (
          <div key={id} className="relative group flex flex-col gap-1.5">
            <div className="flex items-center justify-between px-1">
              {block.meta?.title && (
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                  {block.meta.title}
                </div>
              )}
              <button 
                onClick={() => toggleExpanded(id)}
                className="text-[9px] font-bold uppercase tracking-tighter text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors px-1.5 py-0.5 rounded hover:bg-muted/50"
              >
                {isMinimized ? "Expand" : "Minimize"}
              </button>
            </div>
            
            <div className={cn(
              "transition-all duration-200",
              isMinimized ? "bg-muted/10 rounded-xl border border-border/40 overflow-hidden" : ""
            )}>
              <WidgetRenderer block={block} eventMeta={entry.eventMeta} mode={isMinimized ? "compact" : "full"} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
