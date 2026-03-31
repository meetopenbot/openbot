import { useChat } from "../../hooks/use-chat";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Thread } from "../Thread";
import { Composer } from "../Composer";
import { AttentionRail } from "../AttentionRail";
import { SessionStateSidebar } from "../SessionStateSidebar";
import { api } from "../../lib/api";

interface ChatPageProps {
  sessionId: string;
  showSidebar?: boolean;
}

export function ChatPage({ sessionId, showSidebar = true }: ChatPageProps) {
  const { reset } = useChat();
  const [loadedSessions, setLoadedSessions] = useState<Set<string>>(new Set());
  const prevSessionRef = useRef<string | null>(null);

  const { data: events } = useQuery({
    queryKey: ["session-events", sessionId],
    queryFn: () => api.getSessionEvents(sessionId),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (events === undefined) return;
    if (prevSessionRef.current === sessionId && loadedSessions.has(sessionId))
      return;

    prevSessionRef.current = sessionId;
    reset(events);
    setLoadedSessions((prev) => new Set(prev).add(sessionId));
  }, [events, sessionId, reset, loadedSessions]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      <div className="flex-1 flex flex-col h-full min-w-0">
        <div className="flex-1 overflow-auto">
          <Thread placeholder={<ChatPlaceholder />} />
        </div>
        <div className="px-5 pb-5 pt-0 shrink-0">
          <AttentionRail />
          <Composer />
        </div>
      </div>
      {showSidebar && (
        <div className="w-[300px] border-l border-border/50 hidden lg:block overflow-auto">
           <SessionStateSidebar />
        </div>
      )}
    </div>
  );
}

function ChatPlaceholder() {
  const { send } = useChat();

  const { data: suggestions = [] } = useQuery({
    queryKey: ["prompts"],
    queryFn: () => api.getPrompts(),
  });

  return (
    <div className="flex flex-col items-start gap-4 max-w-lg w-full animate-fade-in">
      <div className="flex items-start gap-3 text-left">
        <div className="size-9 shrink-0 rounded-lg bg-foreground/4 border border-border/50 flex items-center justify-center mt-0.5">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-foreground/45"
          >
            <path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9-9-1.8-9-9 1.8-9 9-9" />
            <path d="M8 12h.01" />
            <path d="M12 12h.01" />
            <path d="M16 12h.01" />
          </svg>
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <h1 className="text-[15px] font-semibold tracking-tight text-foreground">
            What can I help with?
          </h1>
          <p className="text-[12px] text-muted-foreground/75 leading-snug">
            Your AI sidekick for files, terminal, and more.
          </p>
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5 w-full pl-12 mb-8">
          {suggestions.map((s) => (
            <button
              key={s.label}
              onClick={() =>
                send({ type: "agent:input", data: { content: s.label } })
              }
              className="text-left text-[12px] px-2.5 py-1.5 rounded-md border border-border/50 hover:border-border/80 hover:bg-muted/35 transition-colors duration-150 text-muted-foreground hover:text-foreground w-fit max-w-full"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
