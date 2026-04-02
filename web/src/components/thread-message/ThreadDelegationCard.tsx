import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { AgentAvatar } from "../AgentAvatar";
import { WidgetRenderer } from "../WidgetRenderer";
import { cn } from "../../lib/utils";
import { ThreadStreamEventItem } from "./ThreadStreamEventItem";

export function ThreadDelegationCard({
  startEvent,
  endEvent,
  subEvents,
}: {
  startEvent: any;
  endEvent?: any;
  subEvents: any[];
}) {
  const isCompleted = !!endEvent;
  const agentName = startEvent.meta?.agentName || startEvent.data.agent;
  const task = startEvent.data.task;
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="flex flex-col w-full items-start my-2 p-2 rounded-lg border border-border/40 bg-muted/5 hover:bg-muted/10 transition-colors group">
      <div
        className="flex items-center justify-between w-full cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2.5">
          <div className="size-6 rounded bg-primary/10 flex items-center justify-center">
            <AgentAvatar name={agentName} className="size-4 rounded-sm" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-bold text-foreground/80">
                {agentName}
              </span>
              {!isCompleted && (
                <div className="flex gap-0.5">
                  <span className="size-1 rounded-full bg-primary/40 animate-pulse" />
                  <span className="size-1 rounded-full bg-primary/40 animate-pulse [animation-delay:0.2s]" />
                </div>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground line-clamp-1 italic">
              {task}
            </div>
          </div>
        </div>
        <div
          className={cn(
            "text-muted-foreground/40 transition-transform duration-200",
            isExpanded && "rotate-180",
          )}
        >
          <ChevronDown className="size-4" aria-hidden />
        </div>
      </div>

      {isExpanded && (
        <div className="w-full mt-3 pl-8 animate-fade-in">
          <div className="flex flex-col gap-0.5 mb-3">
            {subEvents.map((event, idx) => (
              <ThreadStreamEventItem key={event.id || idx} event={event} />
            ))}

            {subEvents.length === 0 && !isCompleted && (
              <div className="flex items-center gap-2 py-1 px-2 text-[10px] text-muted-foreground/50 italic animate-pulse">
                <span>Starting...</span>
              </div>
            )}
          </div>

          {isCompleted && endEvent.data.result && (
            <div className="pt-2 mt-2 border-t border-border/10">
              <div className="text-[12px] text-foreground/90 leading-relaxed">
                {typeof endEvent.data.result === "string" ? (
                  <WidgetRenderer
                    block={{
                      type: "ui-block",
                      widget: "text",
                      props: { value: endEvent.data.result },
                      placement: "thread",
                    }}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap font-mono text-[10px] bg-background/30 p-2 rounded border border-border/10">
                    {JSON.stringify(endEvent.data.result, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
