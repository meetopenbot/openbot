import { useChat } from "../hooks/use-chat";
import { useEffect, useRef, type ReactNode, useMemo, useState } from "react";
import { AgentAvatar } from "./AgentAvatar";
import { useConfig } from "../hooks/use-config";
import { WidgetRenderer } from "./WidgetRenderer";
import { cn } from "../lib/utils";

const TEXT_EVENT_TYPES = new Set([
  "agent:output",
  "agent:output-delta",
  "agent:input",
]);

const DELEGATION_EVENT_TYPES = new Set([
  "delegation:start",
  "delegation:end",
]);

function formatTime(timestamp?: number) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function hasRenderableContent(message: { content: any }): boolean {
  if (typeof message.content === 'string') {
    return message.content.length > 0;
  }
  if (!Array.isArray(message.content)) return false;
  return message.content.some((event: any) => (
    (event.type === "ui" && event.data?.placement !== "sidebar" && event.data?.placement !== "attention") ||
    TEXT_EVENT_TYPES.has(event.type) ||
    DELEGATION_EVENT_TYPES.has(event.type)
  ));
}

function StreamingIndicator() {
  return (
    <div className="flex items-start w-full px-5 py-2 animate-fade-in">
      <div className="w-[36px] mr-3 shrink-0" />
      <div className="flex items-center gap-1.5 py-1">
        <span className="size-1 rounded-full bg-foreground/30 animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
        <span className="size-1 rounded-full bg-foreground/30 animate-[pulse-dot_1.4s_ease-in-out_0.2s_infinite]" />
        <span className="size-1 rounded-full bg-foreground/30 animate-[pulse-dot_1.4s_ease-in-out_0.4s_infinite]" />
      </div>
    </div>
  );
}

function EventItem({ event }: { event: any }) {
  const type = event.type;
  const data = event.data;

  switch (type) {
    case "browser:status":
      return (
        <div className="flex items-center gap-2 py-0.5 px-2 hover:bg-muted/40 rounded transition-colors group">
          <div className="size-1 rounded-full bg-primary/40 group-hover:bg-primary/60 shrink-0" />
          <span className="text-[11px] leading-relaxed text-foreground/60 truncate">{data?.message}</span>
        </div>
      );
    case "browser:screenshot":
      return (
        <div className="my-2">
          <div className="relative group overflow-hidden rounded-lg border border-border/40 bg-muted/20 inline-block">
            <img 
              src={data?.url} 
              alt="Browser Screenshot" 
              className="max-w-full h-auto object-cover max-h-60" 
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <a href={data?.url} target="_blank" rel="noreferrer" className="text-[10px] text-white font-medium bg-black/60 px-2 py-1 rounded">View Full</a>
            </div>
          </div>
        </div>
      );
    case "agent:output":
    case "agent:output-delta": {
      const rawContent = typeof data === 'string' ? data : (data?.content ?? data?.result ?? data?.message);
      if (!rawContent) return null;

      if (typeof rawContent === 'object' && rawContent.type === "ui-block") {
        return (
          <div className="py-1">
            <WidgetRenderer block={rawContent as any} />
          </div>
        );
      }

      const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent, null, 2);
      
      return (
        <div className="py-0.5">
          <WidgetRenderer block={{ type: "ui-block", widget: "text", props: { value: content }, placement: "thread" }} />
        </div>
      );
    }
    case "ui":
      if (data?.placement === "sidebar" || data?.placement === "attention") return null;
      return (
        <div className="py-1">
          <WidgetRenderer block={data} eventMeta={event.meta} />
        </div>
      );
    case "agent:sub-action":
      return (
        <div className="flex items-center gap-2 py-0.5 px-2 text-[10px] text-muted-foreground/60 italic">
          <div className="size-1 rounded-full bg-muted-foreground/20" />
          <span>{data?.originalType || data?.action}</span>
        </div>
      );
    default:
      if (data && typeof data === 'object' && (data.message || data.content)) {
          const displayValue = data.message || data.content;
          const isBlock = typeof displayValue === 'object' && displayValue.type === "ui-block";
          
          return (
            <div className="flex items-start gap-2 py-0.5 px-2">
               <div className="mt-1.5 size-1 rounded-full bg-muted-foreground/10 shrink-0" />
               <div className="text-[11px] text-muted-foreground/70">
                  {isBlock ? (
                    <WidgetRenderer block={displayValue} />
                  ) : (
                    typeof displayValue === 'string' ? displayValue : JSON.stringify(displayValue, null, 2)
                  )}
               </div>
            </div>
          );
      }
      return null;
  }
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
              <span className="text-[12px] font-bold text-foreground/80">{agentName}</span>
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
        <div className={cn("text-muted-foreground/40 transition-transform duration-200", isExpanded && "rotate-180")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
        </div>
      </div>
      
      {isExpanded && (
        <div className="w-full mt-3 pl-8 animate-fade-in">
          <div className="flex flex-col gap-0.5 mb-3">
            {subEvents.map((event, idx) => (
              <EventItem key={event.id || idx} event={event} />
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
                 {typeof endEvent.data.result === 'string' ? (
                   <WidgetRenderer block={{ type: "ui-block", widget: "text", props: { value: endEvent.data.result }, placement: "thread" }} />
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

export function Thread({
  placeholder,
  placeholderNode,
}: {
  placeholder?: ReactNode;
  placeholderNode?: any;
}) {
  const { messages, streaming } = useChat();
  const { data: config } = useConfig();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  useEffect(() => {
    const scrollContainer = bottomRef.current?.closest('.overflow-auto');
    if (!scrollContainer) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const distanceToBottom = scrollHeight - scrollTop - clientHeight;
      setIsScrolledUp(distanceToBottom > 100);
    };

    scrollContainer.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, []);

  const visibleMessages = messages
    .filter((m) => m.role !== "system")
    .filter(hasRenderableContent);

  const renderableEvents = useMemo(() => {
    const events: any[] = [];
    
    visibleMessages.forEach((msg, msgIndex) => {
      const delegationMap = new Map<string, { start?: any, end?: any, subs: any[] }>();
      const topLevelEvents: any[] = [];

      const content = Array.isArray(msg.content) ? msg.content : [{
        type: msg.role === "user" ? "agent:input" : "agent:output",
        data: { content: msg.content },
        meta: { timestamp: (msg as any).timestamp || Date.now() }
      }];

      content.forEach((event: any, eventIndex: number) => {
        const delegationId = event.meta?.delegationId;
        if (delegationId) {
          if (!delegationMap.has(delegationId)) {
            delegationMap.set(delegationId, { subs: [] });
          }
          const group = delegationMap.get(delegationId)!;

          if (event.type === "delegation:start") {
            group.start = event;
            topLevelEvents.push({ type: 'delegation-group', delegationId });
          } else if (event.type === "delegation:end") {
            group.end = event;
          } else {
            if (event.type === "agent:output-delta") {
              const hasFinalOutput = content.some((e: any) => e.type === "agent:output" && e.meta?.delegationId === delegationId);
              if (hasFinalOutput) return;
              const nextDelta = content.slice(eventIndex + 1).find((e: any) => e.type === "agent:output-delta" && e.meta?.delegationId === delegationId);
              if (nextDelta) return;
            }
            group.subs.push(event);
          }
          return;
        }

        if (event.type === "agent:output-delta") {
          const hasFinalOutput = content.some((e: any) => e.type === "agent:output");
          if (hasFinalOutput) return;
          const nextDelta = content.slice(eventIndex + 1).find((e: any) => e.type === "agent:output-delta");
          if (nextDelta) return;
        }

        if (event.type === "ui" || TEXT_EVENT_TYPES.has(event.type)) {
          if (event.type === "ui" && (event.data?.placement === "sidebar" || event.data?.placement === "attention")) return;
          topLevelEvents.push(event);
        }
      });

      topLevelEvents.forEach((item, idx) => {
        const eventTimestamp = item.meta?.timestamp || (msg as any).timestamp || Date.now();
        const agentName = item.meta?.agentName || (msg.role === "user" ? "You" : (config?.name || "Assistant"));
        
        if (item.type === 'delegation-group') {
          const group = delegationMap.get(item.delegationId);
          if (group?.start) {
            events.push({
              key: `${msgIndex}-delegation-${item.delegationId}`,
              type: 'delegation',
              data: group,
              meta: {
                timestamp: eventTimestamp,
                agentName,
                role: msg.role
              }
            });
          }
        } else {
          events.push({
            key: `${msgIndex}-${item.type}-${idx}`,
            type: 'standard',
            event: item,
            meta: {
              timestamp: eventTimestamp,
              agentName,
              role: msg.role
            }
          });
        }
      });
    });

    // Add grouping logic
    return events.map((item, index) => {
      const prev = events[index - 1];
      let isGrouped = false;
      if (prev && prev.meta.agentName === item.meta.agentName && item.type === 'standard' && prev.type === 'standard') {
        const timeDiff = item.meta.timestamp - prev.meta.timestamp;
        if (timeDiff < 5 * 60 * 1000) { // 5 minutes
          isGrouped = true;
        }
      }
      return { ...item, isGrouped };
    });
  }, [visibleMessages, config?.name]);

  const isScrolledUpRef = useRef(isScrolledUp);
  useEffect(() => {
    isScrolledUpRef.current = isScrolledUp;
  }, [isScrolledUp]);

  useEffect(() => {
    if (!isScrolledUpRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
    }
  }, [renderableEvents, streaming]);

  if (renderableEvents.length === 0) {
    return (
      <div className="flex flex-col justify-end items-start h-full min-h-[400px] w-full px-5 pb-1 pt-8">
        {placeholder}
        {!placeholder && placeholderNode && <WidgetRenderer block={placeholderNode} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 w-full py-4">
      {renderableEvents.map((item) => {
        const { meta, isGrouped } = item;
        const isUser = meta.role === "user";
        
        return (
          <div 
            key={item.key} 
            className={cn(
              "group flex flex-col w-full px-5 hover:bg-muted/10 transition-colors duration-75",
              isGrouped ? "py-0.5" : "py-2 mt-2"
            )}
          >
            <div className="flex w-full items-start gap-3">
              {/* Avatar Column */}
              <div className="w-[36px] shrink-0">
                {!isGrouped && (
                  <AgentAvatar 
                    name={isUser ? "user" : (item.event?.meta?.agentName || item.data?.start?.meta?.agentName || "default")} 
                    className="size-9 rounded-md shadow-sm"
                  />
                )}
                {isGrouped && (
                   <div className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-muted-foreground/60 text-right mt-1.5 pr-1 font-medium">
                     {formatTime(meta.timestamp).split(' ')[0]}
                   </div>
                )}
              </div>

              {/* Content Column */}
              <div className="flex-1 min-w-0">
                {!isGrouped && (
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-foreground hover:underline cursor-pointer">
                      {meta.agentName}
                    </span>
                    <span className="text-xs text-muted-foreground/60">
                      {formatTime(meta.timestamp)}
                    </span>
                  </div>
                )}

                <div className="text-[15px] leading-[1.46668] text-foreground/90">
                  {item.type === 'delegation' ? (
                    <DelegationCard 
                      startEvent={item.data.start}
                      endEvent={item.data.end}
                      subEvents={item.data.subs}
                    />
                  ) : (
                    <div className="flex flex-col gap-2">
                      {item.event.type === "ui" ? (
                         <WidgetRenderer block={item.event.data} eventMeta={item.event.meta} />
                      ) : (
                        (() => {
                          const event = item.event;
                          const rawContent = event.data?.content ?? event.data?.result ?? event.data?.message;
                          const attachments = Array.isArray(event.data?.attachments) ? event.data.attachments : [];
                          const isBlock = typeof rawContent === 'object' && rawContent.type === "ui-block";

                          return (
                            <>
                              {rawContent && (
                                <div className="max-w-full">
                                  {isBlock ? (
                                    <WidgetRenderer block={rawContent as any} />
                                  ) : (
                                    <WidgetRenderer block={{ 
                                      type: "ui-block", 
                                      widget: "text", 
                                      props: { 
                                        value: typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent, null, 2), 
                                      },
                                      placement: "thread"
                                    } as any} />
                                  )}
                                </div>
                              )}
                              {attachments.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {attachments.map((attachment: any) => (
                                    <a
                                      key={attachment.id}
                                      href={attachment.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block overflow-hidden rounded-lg border border-border/40 hover:border-border/60 transition-colors"
                                    >
                                      <img
                                        src={attachment.url}
                                        alt={attachment.name || "attachment"}
                                        className="max-h-80 w-auto object-contain bg-muted/20"
                                      />
                                    </a>
                                  ))}
                                </div>
                              )}
                            </>
                          );
                        })()
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      {streaming && <StreamingIndicator />}
      <div ref={bottomRef} className="h-0" />
      
      {/* Scroll to bottom button */}
      {isScrolledUp && (
        <div className="fixed bottom-[110px] left-1/2 -translate-x-1/2 z-50">
          <button
            onClick={() => {
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
              setIsScrolledUp(false);
            }}
            className="pointer-events-auto px-4 py-2 bg-background/80 backdrop-blur-md border border-border/60 text-foreground/80 rounded-full shadow-lg hover:bg-muted/80 hover:text-foreground transition-all flex items-center gap-2 text-[13px] font-medium"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="M19 12l-7 7-7-7" />
            </svg>
            Scroll to bottom
          </button>
        </div>
      )}
    </div>
  );
}
