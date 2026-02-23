import { useMelony } from "@melony/react";
import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "../hooks/use-session";
import { api } from "../lib/api";
import { AgentAvatar } from "./AgentAvatar";

const BUILT_IN_AGENTS = [
  { name: "os", description: "Handles shell commands and file system operations" },
  { name: "topic", description: "Automatically titles threads" },
  { name: "agent-creator", description: "Helps create new custom agents" },
];

export function Composer() {
  const { send, streaming, stop, events } = useMelony();
  const { sessionId } = useSession();
  const [content, setContent] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [popoverIndex, setPopoverIndex] = useState(0);

  const { data: customAgents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
  });

  const isTypingAgent = content.startsWith("@") && !content.includes(" ");
  const agentQuery = isTypingAgent ? content.slice(1).toLowerCase() : "";
  
  const allAgents = [...BUILT_IN_AGENTS, ...customAgents];
  const filteredAgents = allAgents.filter(a => a.name.toLowerCase().includes(agentQuery));
  const showAgentPopover = isTypingAgent && filteredAgents.length > 0;

  useEffect(() => {
    if (showAgentPopover) {
      setPopoverIndex(0);
    }
  }, [agentQuery, showAgentPopover]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!content.trim() || streaming) return;

    const finalContent = selectedAgent 
      ? `@${selectedAgent} ${content.trim()}`
      : content.trim();

    send({
      type: "user:text",
      data: { content: finalContent },
    });
    setContent("");
    // Do NOT reset selectedAgent here, so it sticks between messages!
  };

  const handleStop = () => {
    stop();
  };

  const handleSelectAgent = (agentName: string) => {
    setSelectedAgent(agentName);
    setContent("");
    textareaRef.current?.focus();
  };

  const handleRemoveAgent = () => {
    setSelectedAgent(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showAgentPopover) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPopoverIndex((prev) => Math.min(prev + 1, filteredAgents.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPopoverIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filteredAgents[popoverIndex]) {
          handleSelectAgent(filteredAgents[popoverIndex].name);
        }
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }

    if (e.key === "Backspace" && content === "" && selectedAgent) {
      handleRemoveAgent();
    }
  };

  useEffect(() => {
    setContent("");
    setSelectedAgent(null);
    
    // Check for pre-filled message in URL
    const params = new URLSearchParams(window.location.search);
    const msg = params.get("msg");
    if (msg) {
      if ((msg.startsWith("/") || msg.startsWith("@")) && msg.includes(" ")) {
        const firstSpace = msg.indexOf(" ");
        const prefix = msg.slice(1, firstSpace);
        const rest = msg.slice(firstSpace + 1).trim();
        
        // Trust the prefix from the URL
        setSelectedAgent(prefix);
        setContent(rest);
      } else {
        setContent(msg);
      }
      
      // Clean up the URL
      const newUrl = window.location.pathname + "?tab=" + (params.get("tab") || "chat");
      window.history.replaceState({}, "", newUrl);
    }
  }, [sessionId]);

  useEffect(() => {
    const handleSetText = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      const msg = customEvent.detail;
      if (msg) {
        if ((msg.startsWith("/") || msg.startsWith("@")) && msg.includes(" ")) {
          const firstSpace = msg.indexOf(" ");
          const prefix = msg.slice(1, firstSpace);
          const rest = msg.slice(firstSpace + 1).trim();
          
          setSelectedAgent(prefix);
          setContent(rest);
        } else {
          setContent(msg);
        }
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
    };

    window.addEventListener('set-composer-text', handleSetText);
    return () => window.removeEventListener('set-composer-text', handleSetText);
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      if (content === "") {
        textareaRef.current.style.height = "44px";
      } else {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
      }
    }
  }, [content]);

  useEffect(() => {
    if (!streaming) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [streaming, sessionId]);

  const canSend = Boolean(content.trim()) && !streaming;

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

  const usageData = usageEvent?.data;
  const usageModel = usageData?.model as string | undefined;
  const contextWindowTokens = Number(usageData?.contextWindowTokens ?? 0);
  const sessionTotalTokens = Number(usageData?.session?.totalTokens ?? 0);
  const contextPercent = contextWindowTokens > 0
    ? Math.min((sessionTotalTokens / contextWindowTokens) * 100, 100)
    : 0;
  const circleRadius = 8;
  const circleCircumference = 2 * Math.PI * circleRadius;
  const circleDashOffset = circleCircumference - (circleCircumference * contextPercent) / 100;

  const formatInt = (value: number) => new Intl.NumberFormat().format(Math.max(0, Math.floor(value)));

  return (
    <div className="relative w-full rounded-2xl border border-border/60 bg-background shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-all duration-200 focus-within:border-border focus-within:shadow-[0_2px_20px_rgba(0,0,0,0.06)]">
      {showAgentPopover && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 w-[300px] overflow-hidden rounded-xl border border-border/60 bg-background p-1.5 shadow-xl animate-in fade-in slide-in-from-bottom-2">
          <div className="px-2 pb-1.5 pt-1 text-xs font-medium text-muted-foreground/70">
            Select an Agent
          </div>
          <div className="flex max-h-[240px] flex-col overflow-y-auto">
            {filteredAgents.map((agent, i) => (
              <button
                key={agent.name}
                type="button"
                onMouseEnter={() => setPopoverIndex(i)}
                onClick={() => handleSelectAgent(agent.name)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                  i === popoverIndex ? "bg-muted/60" : "hover:bg-muted/40"
                }`}
              >
                <AgentAvatar name={agent.name} className="w-8 h-8 rounded-lg" />
                <div className="flex flex-col items-start gap-0.5">
                  <div className="text-[13px] font-medium text-foreground">@{agent.name}</div>
                  <div className="line-clamp-1 text-xs text-muted-foreground/70">
                    {agent.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col">
        {selectedAgent && (
          <div className="flex items-center px-3 pt-2.5 pb-2">
            <div className="flex items-center gap-1.5 rounded-md bg-foreground/10 px-2 py-1 text-[11px] font-medium text-foreground">
              <AgentAvatar name={selectedAgent} className="w-3.5 h-3.5 rounded-sm" />
              <span>@{selectedAgent}</span>
              <button
                type="button"
                onClick={handleRemoveAgent}
                className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-foreground/20 hover:text-foreground"
                aria-label="Remove agent"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={selectedAgent ? `Message @${selectedAgent}...` : "Message OpenBot..."}
          className={`min-h-[44px] max-h-[200px] w-full resize-none bg-transparent px-4 ${selectedAgent ? 'pt-1 pb-3' : 'py-3'} text-[13px] leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none`}
          rows={1}
        />
        <div className="flex items-center justify-between px-3 pb-2.5">
          <div className="flex items-center gap-1">
            {contextWindowTokens > 0 && (
              <div className="group relative">
                <div
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground/80 transition-colors group-hover:bg-muted/60 group-hover:text-foreground"
                  aria-label="Context usage"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" className="-rotate-90">
                    <circle
                      cx="10"
                      cy="10"
                      r={circleRadius}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="opacity-20"
                    />
                    <circle
                      cx="10"
                      cy="10"
                      r={circleRadius}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeDasharray={circleCircumference}
                      strokeDashoffset={circleDashOffset}
                      className="transition-all duration-300"
                    />
                  </svg>
                </div>
                <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-0 z-20 hidden min-w-[210px] rounded-lg border border-border/60 bg-background px-2.5 py-2 text-[11px] shadow-xl group-hover:block">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Context</span>
                    <span className="font-medium text-foreground">{contextPercent.toFixed(1)}%</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {formatInt(sessionTotalTokens)} / {formatInt(contextWindowTokens)} tokens
                  </div>
                  {usageModel && (
                    <div className="mt-1 truncate text-muted-foreground/80">
                      {usageModel}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          {streaming ? (
            <button
              type="button"
              onClick={handleStop}
              className="rounded-lg bg-foreground p-1.5 text-background transition-all duration-150 hover:opacity-80"
              aria-label="Stop generation"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="7" y="7" width="10" height="10" rx="1.5" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              className={`rounded-lg p-1.5 transition-all duration-150 ${
                canSend
                  ? "bg-foreground text-background hover:opacity-80"
                  : "cursor-not-allowed text-muted-foreground/30"
              }`}
              aria-label="Send message"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
