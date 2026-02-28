import { useMelony } from "@melony/react";
import { MelonyRenderer, type UINode } from "@melony/ui-kit";
import { useEffect, useRef, type ReactNode, useMemo } from "react";

const TEXT_EVENT_TYPES = new Set([
  "agent:output",
  "agent:output-delta",
  "agent:input",
]);

const DELEGATION_EVENT_TYPES = new Set([
  "delegation:start",
  "delegation:end",
]);

function hasRenderableContent(message: { content: any[] }): boolean {
  return message.content.some((event: any) => (
    event.type === "ui" ||
    TEXT_EVENT_TYPES.has(event.type) ||
    DELEGATION_EVENT_TYPES.has(event.type)
  ));
}

function StreamingIndicator() {
  return (
    <div className="flex items-start w-full animate-fade-in">
      <div className="flex items-center gap-1.5 px-1 py-3">
        <span className="size-1.5 rounded-full bg-foreground/30 animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
        <span className="size-1.5 rounded-full bg-foreground/30 animate-[pulse-dot_1.4s_ease-in-out_0.2s_infinite]" />
        <span className="size-1.5 rounded-full bg-foreground/30 animate-[pulse-dot_1.4s_ease-in-out_0.4s_infinite]" />
      </div>
    </div>
  );
}

function DelegationCard({ 
  startEvent, 
  endEvent, 
  subEvents 
}: { 
  startEvent: any, 
  endEvent?: any, 
  subEvents: any[] 
}) {
  const isCompleted = !!endEvent;
  const agentName = startEvent.data.agent;
  const task = startEvent.data.task;

  // Find the latest status message from sub-events (e.g. browser:status)
  const latestStatus = useMemo(() => {
    const statusEvents = subEvents.filter(e => e.type.includes("status"));
    return statusEvents[statusEvents.length - 1]?.data?.message;
  }, [subEvents]);

  return (
    <div className="flex flex-col w-full items-start animate-fade-in my-2">
      <div className="w-[90%] rounded-xl border border-border/60 bg-muted/30 overflow-hidden shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50 border-b border-border/40">
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-primary animate-pulse" style={{ animationDuration: isCompleted ? '0s' : '2s', opacity: isCompleted ? 0.5 : 1 }} />
            <span className="text-xs font-semibold uppercase tracking-wider text-foreground/70">
              {agentName} Agent
            </span>
          </div>
          {isCompleted ? (
            <span className="text-[10px] bg-success/10 text-success px-2 py-0.5 rounded-full font-medium">Completed</span>
          ) : (
            <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium animate-pulse">Processing</span>
          )}
        </div>

        {/* Content */}
        <div className="p-4 flex flex-col gap-3">
          <div className="text-[13px] text-foreground/80 font-medium italic">
            &quot;{task}&quot;
          </div>
          
          {/* Sub-progress or Status */}
          {(latestStatus || !isCompleted) && (
            <div className="flex items-center gap-2 px-3 py-2 bg-background/50 rounded-lg border border-border/40">
              {!isCompleted && <div className="size-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />}
              <span className="text-xs text-muted-foreground truncate">
                {latestStatus || (isCompleted ? "Task finished" : "Initializing...")}
              </span>
            </div>
          )}

          {/* Result Summary if completed */}
          {isCompleted && endEvent.data.result && (
            <div className="mt-1 pt-3 border-t border-border/40">
               <div className="text-[11px] text-muted-foreground uppercase tracking-widest mb-1 font-bold">Result</div>
               <div className="text-xs text-foreground/90 leading-relaxed line-clamp-3">
                 {typeof endEvent.data.result === 'string' ? endEvent.data.result : JSON.stringify(endEvent.data.result)}
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Thread({
  placeholder,
  placeholderNode,
}: {
  placeholder?: ReactNode;
  placeholderNode?: UINode;
}) {
  const { messages, streaming } = useMelony();
  const bottomRef = useRef<HTMLDivElement>(null);

  const visibleMessages = messages
    .filter((m) => m.role !== "system")
    .filter(hasRenderableContent);

  const seenIds = new Set<string>();

  const renderableEvents = useMemo(() => {
    const events: any[] = [];
    
    // Track delegation states per message to group them
    visibleMessages.forEach((msg, msgIndex) => {
      const delegationMap = new Map<string, { start?: any, end?: any, subs: any[] }>();
      const topLevelEvents: any[] = [];

      msg.content.forEach((event: any, eventIndex: number) => {
        // Skip already seen IDs
        if (event.id) {
          if (seenIds.has(event.id)) return;
          seenIds.add(event.id);
        }

        // Handle Delegation Events
        if (event.delegationId) {
          if (!delegationMap.has(event.delegationId)) {
            delegationMap.set(event.delegationId, { subs: [] });
          }
          const group = delegationMap.get(event.delegationId)!;

          if (event.type === "delegation:start") {
            group.start = event;
            topLevelEvents.push({ type: 'delegation-group', delegationId: event.delegationId });
          } else if (event.type === "delegation:end") {
            group.end = event;
          } else {
            group.subs.push(event);
          }
          return;
        }

        // Handle Text Delta (deduplication)
        if (event.type === "agent:output-delta") {
          const hasFinalOutput = msg.content.some((e: any) => e.type === "agent:output");
          if (hasFinalOutput) return;
          const nextEvent = msg.content[eventIndex + 1];
          if (nextEvent?.type === "agent:output-delta") return;
        }

        // Handle normal renderable events
        if (event.type === "ui" || TEXT_EVENT_TYPES.has(event.type)) {
          topLevelEvents.push(event);
        }
      });

      // Map topLevelEvents back to actual render objects
      topLevelEvents.forEach((item, idx) => {
        if (item.type === 'delegation-group') {
          const group = delegationMap.get(item.delegationId);
          if (group?.start) {
            events.push({
              key: `${msg.runId}-${msgIndex}-delegation-${item.delegationId}`,
              type: 'delegation',
              data: group
            });
          }
        } else {
          events.push({
            key: `${msg.runId}-${msgIndex}-${item.type}-${idx}`,
            type: 'standard',
            event: item
          });
        }
      });
    });

    return events;
  }, [visibleMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
  }, [renderableEvents, streaming]);

  if (renderableEvents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] py-12 gap-8">
        <div className="flex flex-col gap-3">
          {placeholder}
          {!placeholder && placeholderNode && <MelonyRenderer node={placeholderNode} />}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 gap-5 w-full py-6 px-4">
      {renderableEvents.map((item) => {
        if (item.type === 'delegation') {
          return (
            <DelegationCard 
              key={item.key}
              startEvent={item.data.start}
              endEvent={item.data.end}
              subEvents={item.data.subs}
            />
          );
        }

        const { event } = item;
        const isUserEvent = event.type === "agent:input";

        if (event.type === "ui") {
          return (
            <div key={item.key} className="flex flex-col w-full items-start animate-fade-in">
              <div className="max-w-[85%]">
                <MelonyRenderer node={event.data} />
              </div>
            </div>
          );
        }

        if (TEXT_EVENT_TYPES.has(event.type)) {
          const content = typeof event.data?.content === "string" ? event.data.content : "";
          const attachments = Array.isArray(event.data?.attachments) ? event.data.attachments : [];
          if (!content && attachments.length === 0) return null;

          return (
            <div
              key={item.key}
              className={`flex flex-col w-full ${event.type === "agent:output-delta" ? "" : "animate-fade-in"} ${isUserEvent ? "items-end" : "items-start"}`}
            >
              <div className={`max-w-[85%] rounded-2xl ${isUserEvent ? "px-4 py-3 bg-foreground/4 border border-border/40" : ""}`}>
                <div className="flex flex-col gap-2">
                  {content && (
                    <div className={isUserEvent ? "text-[13px] leading-relaxed" : ""}>
                      <MelonyRenderer node={{ type: "markdown", props: { value: content, size: "sm" } } as any} />
                    </div>
                  )}
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {attachments.map((attachment: any) => (
                        <a
                          key={attachment.id}
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block overflow-hidden rounded-lg border border-border/60"
                        >
                          <img
                            src={attachment.url}
                            alt={attachment.name || "attachment"}
                            className="h-40 w-40 object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        }

        return null;
      })}
      {streaming && <StreamingIndicator />}
      <div ref={bottomRef} className="h-0" />
    </div>
  );
}
