import { useMelony } from "@melony/react";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Thread } from "../Thread";
import { Composer } from "../Composer";
import { api } from "../../lib/api";

interface ChatPageProps {
  sessionId: string;
}

export function ChatPage({ sessionId }: ChatPageProps) {
  const { reset } = useMelony();
  const [loadedSessions, setLoadedSessions] = useState<Set<string>>(new Set());
  const prevSessionRef = useRef<string | null>(null);

  const { data: events } = useQuery({
    queryKey: ["session-events", sessionId],
    queryFn: () => api.getSessionEvents(sessionId),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (events === undefined) return;
    if (prevSessionRef.current === sessionId && loadedSessions.has(sessionId)) return;

    prevSessionRef.current = sessionId;
    reset(events);
    setLoadedSessions((prev) => new Set(prev).add(sessionId));
  }, [events, sessionId, reset, loadedSessions]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div className="flex-1 flex flex-col items-center overflow-auto w-full">
        <div className="w-full max-w-[720px] flex flex-col flex-1 px-5">
          <Thread placeholder={<ChatPlaceholder />} />
          <div className="sticky bottom-0 bg-linear-to-t from-background via-background to-transparent pt-4 pb-4">
            <Composer />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatPlaceholder() {
  const { send } = useMelony();

  const { data: suggestions = [] } = useQuery({
    queryKey: ["prompts"],
    queryFn: () => api.getPrompts(),
  });

  return (
    <div className="flex flex-col items-center justify-center flex-1 py-24 gap-10 animate-fade-in">
      <div className="flex flex-col gap-3 items-center text-center">
        <div className="size-12 rounded-2xl bg-foreground/4 border border-border/50 flex items-center justify-center mb-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/50">
            <path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9-9-1.8-9-9 1.8-9 9-9" />
            <path d="M8 12h.01" />
            <path d="M12 12h.01" />
            <path d="M16 12h.01" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">What can I help with?</h1>
        <p className="text-sm text-muted-foreground/70 max-w-sm leading-relaxed">
          Your AI-powered system sidekick with superpowers over files, terminal, and more.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 w-full max-w-md">
        {suggestions.map((s) => (
          <button
            key={s.label}
            onClick={() => send({ type: "user:text", data: { content: s.label } })}
            className="text-left text-[13px] px-4 py-3 rounded-xl border border-border/60 hover:border-border hover:bg-muted/40 transition-all duration-150 text-muted-foreground hover:text-foreground group"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
