import { useMelony } from "@melony/react";
import { MelonyRenderer, type UINode } from "@melony/ui-kit";
import { useEffect, useRef, type ReactNode, useMemo, useState } from "react";
import { AgentAvatar } from "./AgentAvatar";
import { useConfig } from "../hooks/use-config";

const TEXT_EVENT_TYPES = new Set([
  "agent:output",
  "agent:output-delta",
  "agent:input",
]);

const DELEGATION_EVENT_TYPES = new Set([
  "delegation:start",
  "delegation:end",
]);

function hasRenderableContent(message: { content: any }): boolean {
  if (typeof message.content === 'string') {
    return message.content.length > 0;
  }
  if (!Array.isArray(message.content)) return false;
  return message.content.some((event: any) => (
    event.type === "ui" ||
    TEXT_EVENT_TYPES.has(event.type) ||
    DELEGATION_EVENT_TYPES.has(event.type)
  ));
}

function StreamingIndicator() {
  return (
    <div className="flex items-start w-full animate-fade-in">
      <div className="flex items-center gap-1.5 py-3">
        <span className="size-1.5 rounded-full bg-foreground/30 animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
        <span className="size-1.5 rounded-full bg-foreground/30 animate-[pulse-dot_1.4s_ease-in-out_0.2s_infinite]" />
        <span className="size-1.5 rounded-full bg-foreground/30 animate-[pulse-dot_1.4s_ease-in-out_0.4s_infinite]" />
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
        <div className="flex items-start gap-2 py-1 px-2 hover:bg-muted/40 rounded transition-colors group">
          <div className="mt-1.5 size-1 rounded-full bg-primary/40 group-hover:bg-primary/60 shrink-0" />
          <span className="text-[11px] leading-relaxed text-foreground/70 truncate">{data?.message}</span>
        </div>
      );
    case "browser:screenshot":
      return (
        <div className="my-1 px-2">
          <div className="relative group overflow-hidden rounded-lg border border-border/40 bg-muted/20">
            <img 
              src={data?.url} 
              alt="Browser Screenshot" 
              className="w-full h-auto object-cover max-h-40" 
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

      // If content is a UI node, render it directly
      if (typeof rawContent === 'object' && rawContent.type && (rawContent.props || rawContent.children)) {
        return (
          <div className="px-2 py-1 mx-2">
            <MelonyRenderer node={rawContent as any} />
          </div>
        );
      }

      // Otherwise, ensure it's a string for markdown
      const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent, null, 2);
      
      return (
        <div className="px-2 py-1.5 bg-background/40 rounded border border-border/20 my-1 mx-2">
          <MelonyRenderer node={{ type: "markdown", props: { value: content, size: "sm" } } as any} />
        </div>
      );
    }
    case "ui":
      return (
        <div className="px-2 py-1 mx-2">
          <MelonyRenderer node={data} />
        </div>
      );
    case "agent:sub-action":
      return (
        <div className="flex items-center gap-2 py-1 px-2 text-[10px] text-muted-foreground italic">
          <div className="size-1 rounded-full bg-muted-foreground/30" />
          <span>Action: {data?.originalType || data?.action}</span>
        </div>
      );
    default:
      if (data && typeof data === 'object' && (data.message || data.content)) {
          const displayValue = data.message || data.content;
          const isNode = typeof displayValue === 'object' && displayValue.type && (displayValue.props || displayValue.children);
          
          return (
            <div className="flex items-start gap-2 py-1 px-2">
               <div className="mt-1.5 size-1 rounded-full bg-muted-foreground/20 shrink-0" />
               <div className="text-[11px] text-muted-foreground">
                  {isNode ? (
                    <MelonyRenderer node={displayValue} />
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
    <div className="flex flex-col w-full items-start animate-fade-in my-3 pl-4 border-l border-border/40">
      <div 
        className="flex flex-col w-full cursor-pointer group mb-1"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Agent Identification */}
        <div className="flex items-center gap-2 mb-2 w-full">
          <AgentAvatar name={agentName} className="size-5 rounded-md shadow-sm" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/40 group-hover:text-foreground/60 transition-colors">
            {agentName}
          </span>
          {!isCompleted && (
            <div className="flex gap-0.5 ml-1">
              <span className="size-1 rounded-full bg-primary/40 animate-pulse" />
              <span className="size-1 rounded-full bg-primary/40 animate-pulse [animation-delay:0.2s]" />
            </div>
          )}
        </div>

        {/* Task / Intent */}
        <div className="text-[12px] text-foreground/70 font-medium italic leading-relaxed">
          &quot;{task}&quot;
        </div>

        {/* Show Details Toggle */}
        {!isExpanded && (
          <div className="flex items-center gap-1.5 mt-2 text-[10px] text-muted-foreground/40 font-medium group-hover:text-muted-foreground transition-colors uppercase tracking-wider">
            <span>Show Details</span>
            <svg 
              className="w-2.5 h-2.5" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        )}
      </div>
      
      {/* Expanded Content (Sub-events + Result) */}
      {isExpanded && (
        <div className="flex flex-col w-full mt-2 animate-fade-in">
          {/* Sub-events */}
          <div className="flex flex-col gap-0.5 w-full mb-3">
            {subEvents.map((event, idx) => (
              <EventItem key={event.id || idx} event={event} />
            ))}
            
            {subEvents.length === 0 && !isCompleted && (
               <div className="flex items-center gap-2 py-1 px-2 text-[10px] text-muted-foreground/50 italic animate-pulse">
                 <div className="size-1 rounded-full bg-muted-foreground/30 shrink-0" />
                 <span>Starting...</span>
               </div>
            )}
          </div>

          {/* Result if completed */}
          {isCompleted && endEvent.data.result && (
            <div className="pt-3 border-t border-border/10 w-full mb-2">
               <div className="text-[10px] text-muted-foreground/40 uppercase tracking-widest mb-1.5 font-bold">Output</div>
               <div className="text-[12.5px] text-foreground/90 leading-relaxed">
                 {typeof endEvent.data.result === 'string' ? (
                   <MelonyRenderer node={{ type: "markdown", props: { value: endEvent.data.result, size: "sm" } } as any} />
                 ) : (
                   <pre className="whitespace-pre-wrap font-mono text-[10px] bg-background/30 p-2 rounded-lg border border-border/10">
                     {JSON.stringify(endEvent.data.result, null, 2)}
                   </pre>
                 )}
               </div>
            </div>
          )}

          {/* Hide Details button */}
          <button 
            onClick={() => setIsExpanded(false)}
            className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors font-medium flex items-center gap-1 uppercase tracking-wider"
          >
            Hide Details
            <svg 
              className="w-2.5 h-2.5 rotate-180" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
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
  placeholderNode?: UINode;
}) {
  const { messages, streaming } = useMelony();
  const { data: config } = useConfig();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  useEffect(() => {
    const scrollContainer = bottomRef.current?.closest('.overflow-auto');
    if (!scrollContainer) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const distanceToBottom = scrollHeight - scrollTop - clientHeight;
      // Consider "scrolled up" if we are more than 100px from the bottom
      setIsScrolledUp(distanceToBottom > 100);
    };

    scrollContainer.addEventListener('scroll', handleScroll);
    // Initial check
    handleScroll();
    
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, []);

  const visibleMessages = messages
    .filter((m) => m.role !== "system")
    .filter(hasRenderableContent);

  const renderableEvents = useMemo(() => {
    const events: any[] = [];
    
    // Track delegation states per message to group them
    visibleMessages.forEach((msg, msgIndex) => {
      const delegationMap = new Map<string, { start?: any, end?: any, subs: any[] }>();
      const topLevelEvents: any[] = [];

      const content = Array.isArray(msg.content) ? msg.content : [{
        type: msg.role === "user" ? "agent:input" : "agent:output",
        data: { content: msg.content }
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
          topLevelEvents.push(event);
        }
      });

      // Map topLevelEvents back to actual render objects
      topLevelEvents.forEach((item, idx) => {
        if (item.type === 'delegation-group') {
          const group = delegationMap.get(item.delegationId);
          if (group?.start) {
            events.push({
              key: `${msgIndex}-delegation-${item.delegationId}`,
              type: 'delegation',
              data: group
            });
          }
        } else {
          events.push({
            key: `${msgIndex}-${item.type}-${idx}`,
            type: 'standard',
            event: item
          });
        }
      });
    });

    return events;
  }, [visibleMessages]);

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
      {renderableEvents.map((item, index) => {
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
        const isAssistant = !isUserEvent;
        
        let shouldShowHeader = false;
        if (isAssistant) {
          const prevItem = renderableEvents[index - 1];
          if (!prevItem) {
            shouldShowHeader = true;
          } else if (prevItem.type === 'delegation') {
            shouldShowHeader = true;
          } else if (prevItem.type === 'standard') {
            if (prevItem.event.type === 'agent:input') {
              shouldShowHeader = true;
            } else {
              const prevAgentName = prevItem.event.meta?.agentName || "default";
              const currAgentName = event.meta?.agentName || "default";
              if (prevAgentName !== currAgentName) {
                shouldShowHeader = true;
              }
            }
          }
        }

        const displayName = (event.meta?.agentName || config?.name || "Assistant").toUpperCase();
        const avatarName = event.meta?.agentName || "default";
        
        const agentHeader = (
          <div className="flex items-center gap-2 mb-2 animate-fade-in">
            <AgentAvatar name={avatarName} className="size-5 rounded-md shadow-sm bg-muted/20" />
            <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-foreground/60 transition-colors hover:text-foreground/80">
              {displayName}
            </span>
          </div>
        );

        if (event.type === "ui") {
          return (
            <div key={item.key} className="flex flex-col w-full items-start animate-fade-in">
              {shouldShowHeader && agentHeader}
              <div className="max-w-[85%]">
                <MelonyRenderer node={event.data} />
              </div>
            </div>
          );
        }

        if (TEXT_EVENT_TYPES.has(event.type)) {
          const rawContent = event.data?.content ?? event.data?.result ?? event.data?.message;
          if (!rawContent && (!event.data?.attachments || event.data.attachments.length === 0)) return null;

          const attachments = Array.isArray(event.data?.attachments) ? event.data.attachments : [];
          const isNode = typeof rawContent === 'object' && rawContent.type && (rawContent.props || rawContent.children);

          return (
            <div
              key={item.key}
              className={`flex flex-col w-full ${event.type === "agent:output-delta" ? "" : "animate-fade-in"} ${isUserEvent ? "items-end" : "items-start"}`}
            >
              {shouldShowHeader && agentHeader}
              <div className={`max-w-[85%] rounded-2xl ${isUserEvent ? "px-4 py-3 bg-foreground/5" : ""}`}>
                <div className="flex flex-col gap-2">
                  {rawContent && (
                    <div className={isUserEvent ? "text-[13px] leading-relaxed" : ""}>
                      {isNode ? (
                        <MelonyRenderer node={rawContent as any} />
                      ) : (
                        <MelonyRenderer node={{ 
                          type: "markdown", 
                          props: { 
                            value: typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent, null, 2), 
                            size: "sm" 
                          } 
                        } as any} />
                      )}
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
      <div className="sticky bottom-[120px] w-full flex justify-center z-50 pointer-events-none mt-4">
        {isScrolledUp && (
          <button
            onClick={() => {
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
              setIsScrolledUp(false);
            }}
            className="pointer-events-auto px-4 py-2 bg-background/80 backdrop-blur-md border border-border/60 text-foreground/80 rounded-full shadow-lg hover:bg-muted/80 hover:text-foreground transition-all animate-fade-in flex items-center justify-center gap-2 text-[13px] font-medium cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="M19 12l-7 7-7-7" />
            </svg>
            Scroll to bottom
          </button>
        )}
      </div>
    </div>
  );
}
