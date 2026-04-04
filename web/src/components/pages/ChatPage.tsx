import { useChat } from "../../hooks/use-chat";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Chat } from "../Chat";
import { Composer } from "../Composer";
import { AttentionRail } from "../AttentionRail";
import { AgentAvatar } from "../AgentAvatar";
import { useConversations } from "../../hooks/use-sessions";
import { useSession } from "../../hooks/use-session";
import { api } from "../../lib/api";

interface ChatPageProps {
  conversationId: string;
  onReply?: (id: string) => void;
}

export function ChatPage({ conversationId, onReply }: ChatPageProps) {
  const { reset } = useChat();
  const [loadedConversations, setLoadedConversations] = useState<Set<string>>(new Set());
  const prevConversationRef = useRef<string | null>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);

  const handleReply = useCallback(
    (messageId: string) => {
      const el = mainScrollRef.current;
      const top = el?.scrollTop ?? 0;
      onReply?.(messageId);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const pane = mainScrollRef.current;
          if (pane) pane.scrollTop = top;
        });
      });
    },
    [onReply],
  );

  const { data: events } = useQuery({
    queryKey: ["conversation-events", conversationId],
    queryFn: () => api.getConversationEvents(conversationId),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (events === undefined) return;
    if (prevConversationRef.current === conversationId && loadedConversations.has(conversationId))
      return;

    prevConversationRef.current = conversationId;
    reset(events);
    setLoadedConversations((prev) => new Set(prev).add(conversationId));
  }, [events, conversationId, reset, loadedConversations]);

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      <div ref={mainScrollRef} className="flex-1 overflow-auto">
        <Chat
          placeholder={<ChatPlaceholder />}
          onReply={onReply ? handleReply : undefined}
        />
      </div>
      <div className="px-4 pb-4 pt-0 shrink-0">
        <AttentionRail />
        <Composer />
      </div>
    </div>
  );
}

function ChatPlaceholder() {
  const { send } = useChat();
  const { conversationId } = useSession();
  const { data: conversations = [] } = useConversations();
  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
  });

  const { data: suggestions = [] } = useQuery({
    queryKey: ["prompts"],
    queryFn: () => api.getPrompts(),
  });
  const isChannelConversation = conversationId.startsWith("channel_");

  const activeConversation = conversations.find((conversation) => conversation.id === conversationId);
  const dmAgentIdFromRoute = conversationId.startsWith("dm_") ? conversationId.slice(3) : undefined;
  const resolvedAgentId = activeConversation?.agentId || dmAgentIdFromRoute;
  const activeAgent =
    resolvedAgentId
      ? agents.find(
          (agent) =>
            agent.id === resolvedAgentId || agent.name === resolvedAgentId,
        )
      : null;

  const channelTitle = activeConversation?.title?.trim();
  const title = activeAgent?.name
    ?? (isChannelConversation ? (channelTitle || "New channel") : "What can I help with?");
  const subtitle = activeAgent?.description
    ?? (isChannelConversation
      ? "Send a message to start the conversation."
      : "Your AI sidekick for files, terminal, and more.");

  return (
    <div className="flex flex-col items-start gap-4 max-w-lg w-full animate-fade-in">
      <div className="flex items-start gap-3 text-left">
        {activeAgent ? (
          <AgentAvatar
            name={activeAgent.isDefault ? "default" : activeAgent.id}
            label={activeAgent.name}
            imageUrl={activeAgent.image}
            className="size-9 shrink-0 rounded-md mt-0.5"
          />
        ) : (
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
        )}
        <div className="flex flex-col gap-1 min-w-0">
          <h1 className="text-[15px] font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-[12px] text-muted-foreground/75 leading-snug">
            {subtitle}
          </p>
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5 w-full pl-12 mb-8">
          {suggestions.map((s) => (
            <button
              key={s.label}
              onClick={() =>
                send({
                  type: "agent:input",
                  meta: resolvedAgentId ? { agentName: resolvedAgentId } : undefined,
                  data: { content: s.label },
                })
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
