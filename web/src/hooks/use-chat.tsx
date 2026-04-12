import React, { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, BASE_URL } from "../lib/api";

export type MessageReactionSentiment = "like" | "dislike";

interface ChatContextType {
  send: (payload: any) => Promise<void>;
  stop: () => void;
  streaming: boolean;
  activeAgentId: string | null;
  events: any[];
  messages: any[];
  messageReactions: Record<string, MessageReactionSentiment>;
  setMessageReaction: (
    targetMessageId: string,
    reaction: MessageReactionSentiment | "none",
  ) => Promise<void>;
  reset: (events: any[]) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

type ChatEventHandler = (chunk: any) => Promise<void> | void;

function mergeUniqueEvents(previous: any[], incoming: any[]): any[] {
  if (incoming.length === 0) return previous;
  const existingIds = new Set(previous.map((item) => item?.id).filter(Boolean));
  const next = [...previous];
  for (const event of incoming) {
    const id = event?.id;
    if (id && existingIds.has(id)) continue;
    if (id) existingIds.add(id);
    next.push(event);
  }
  return next;
}

export function ChatProvider({ 
  children, 
  conversationId, 
  eventHandlers,
}: { 
  children: React.ReactNode; 
  conversationId: string; 
  eventHandlers?: Record<string, ChatEventHandler>;
}) {
  const [events, setEvents] = useState<any[]>([]);
  const [eventsHydrated, setEventsHydrated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const latestEventIdRef = useRef<string | null>(null);

  const {
    data: bootstrappedEvents,
    isFetched: eventsFetchSettled,
    isError: eventsQueryError,
  } = useQuery({
    queryKey: ["conversation-events", conversationId],
    queryFn: () => api.getConversationEvents(conversationId),
    staleTime: Infinity,
    enabled: Boolean(conversationId),
  });

  const { activeRunId, activeAgentId } = useMemo(() => {
    let depth = 0;
    let latestRunId: string | null = null;
    let latestAgentId: string | null = null;
    for (const event of events) {
      if (!event || typeof event !== "object") continue;
      const runId = event.data?.runId || event.runId || event.meta?.runId;
      const agentId = event.meta?.agentId;

      if (event.type === "run:started") {
        depth++;
        latestRunId = runId;
        if (agentId) latestAgentId = agentId;
      } else if (
        event.type === "run:finished" ||
        event.type === "run:cancelled" ||
        event.type === "run:failed"
      ) {
        depth = Math.max(0, depth - 1);
        if (depth === 0) {
          latestRunId = null;
          latestAgentId = null;
        }
      }

      if (depth > 0 && agentId) {
        latestAgentId = agentId;
      }
    }
    return { activeRunId: latestRunId, activeAgentId: latestAgentId };
  }, [events]);

  const streaming = useMemo(() => isSubmitting || !!activeRunId, [isSubmitting, activeRunId]);

  /** Server-side active runs (this conv or others) — cheap poll only while this conv looks idle. */
  const { data: conversationsActivity } = useQuery({
    queryKey: ["conversations-activity"],
    queryFn: api.getConversationsActivity,
    enabled: Boolean(conversationId) && eventsHydrated,
    staleTime: 4_000,
    refetchInterval: (q) => {
      if (!conversationId) return false;
      const by = (q.state.data as { byConversation?: Record<string, { active?: boolean }> } | undefined)
        ?.byConversation;
      if (by?.[conversationId]?.active) return false;
      return 5_000;
    },
  });

  const remoteConversationActive = Boolean(
    conversationsActivity?.byConversation?.[conversationId]?.active,
  );

  /** Long-lived SSE only when something may append events for this conversation. */
  const needLiveEvents = streaming || remoteConversationActive;

  // Compute messages and reaction map from events
  const { messages, messageReactions } = useMemo(() => {
    const msgs: any[] = [];
    const reactions: Record<string, MessageReactionSentiment> = {};
    let currentMsg: any = null;
    const seenIds = new Set<string>();

    events.forEach((event) => {
      if (event.id && seenIds.has(event.id)) return;
      if (event.id) seenIds.add(event.id);

      if (event.type === "message:reaction") {
        const tid = event.data?.targetMessageId;
        const r = event.data?.reaction;
        if (typeof tid === "string" && tid) {
          if (r === "none") delete reactions[tid];
          else if (r === "like" || r === "dislike") reactions[tid] = r;
        }
        return;
      }

      // Channel handoff — timeline row (from → to)
      if (event.type === "agent:handoff") {
        const fromId = event.data?.fromAgentId;
        currentMsg = {
          id: event.id || `asst_${Math.random().toString(36).slice(2, 9)}`,
          runId: event.runId || event.meta?.runId,
          role: "assistant",
          agentId: typeof fromId === "string" ? fromId : event.meta?.agentId,
          content: [event],
        };
        msgs.push(currentMsg);
        return;
      }

      // Delegation announcement — always its own block
      if (event.type === "agent:delegation") {
        currentMsg = {
          id: event.id || `asst_${Math.random().toString(36).slice(2, 9)}`,
          runId: event.runId || event.meta?.runId,
          role: "assistant",
          agentId: event.meta?.agentId,
          delegationId: event.id,
          content: [event],
        };
        msgs.push(currentMsg);
        return;
      }

      if (event.type === "user:input") {
        currentMsg = {
          id: event.id || Math.random().toString(36).substring(7),
          runId: event.runId || event.meta?.runId,
          role: "user",
          content: [event],
        };
        msgs.push(currentMsg);
      } else if (currentMsg?.role === "assistant") {
        const eventAgentId = event.meta?.agentId;
        const eventDelegationId = event.meta?.delegationId;

        // Start a new block when the agent id or delegation context changes
        const agentChanged = eventAgentId && currentMsg.agentId && eventAgentId !== currentMsg.agentId;
        const delegationChanged = (eventDelegationId || undefined) !== (currentMsg.delegationId || undefined);

        if (agentChanged || delegationChanged) {
          currentMsg = {
            id: event.id || `asst_${Math.random().toString(36).slice(2, 9)}`,
            runId: event.runId || event.meta?.runId,
            role: "assistant",
            agentId: eventAgentId,
            delegationId: eventDelegationId,
            content: [event],
          };
          msgs.push(currentMsg);
        } else {
          if (!currentMsg.agentId && eventAgentId) {
            currentMsg.agentId = eventAgentId;
          }
          currentMsg.content.push(event);
        }
      } else {
        currentMsg = {
          id: event.id || `asst_${Math.random().toString(36).slice(2, 9)}`,
          runId: event.runId || event.meta?.runId,
          role: "assistant",
          agentId: event.meta?.agentId,
          delegationId: event.meta?.delegationId,
          content: [event],
        };
        msgs.push(currentMsg);
      }
    });

    return { messages: msgs, messageReactions: reactions };
  }, [events]);

  const reset = useCallback((newEvents: any[]) => {
    setEvents(mergeUniqueEvents([], newEvents));
  }, []);

  const send = useCallback(async (payload: any) => {
    if (streaming) return;
    setIsSubmitting(true);

    // Ensure we have a stable ID for deduplication
    const eventWithId = {
      ...payload,
      id: payload.id || Math.random().toString(36).substring(7),
      timestamp: Date.now()
    };

    // Add the user input event immediately for UX
    setEvents(prev => [...prev, eventWithId]);

    try {
      await api.createRun(conversationId, eventWithId);
      if (eventHandlers && eventHandlers[payload.type]) {
        await eventHandlers[payload.type](eventWithId);
      }
    } catch (error) {
      console.error("Failed to create run:", error);
    } finally {
      setIsSubmitting(false);
    }
  }, [conversationId, eventHandlers, streaming]);

  const stop = useCallback(() => {
    if (!activeRunId) return;
    void api.cancelRun(activeRunId).catch((err) => {
      console.error("Failed to cancel run:", err);
    });
  }, [activeRunId]);

  const setMessageReaction = useCallback(
    async (targetMessageId: string, reaction: MessageReactionSentiment | "none") => {
      const optimistic = {
        type: "message:reaction" as const,
        data: { targetMessageId, reaction },
        id: `local_${crypto.randomUUID()}`,
        timestamp: Date.now(),
        runId: "client",
      };
      setEvents((prev) => [...prev, optimistic]);
      try {
        await api.postMessageReaction(conversationId, { targetMessageId, reaction });
      } catch (err) {
        console.error("Failed to save reaction:", err);
        setEvents((prev) => prev.filter((ev) => ev.id !== optimistic.id));
      }
    },
    [conversationId],
  );

  const value = useMemo(() => ({
    send,
    stop,
    streaming,
    activeAgentId,
    events,
    messages,
    messageReactions,
    setMessageReaction,
    reset
  }), [send, stop, streaming, events, messages, messageReactions, setMessageReaction, reset]);

  useEffect(() => {
    latestEventIdRef.current = null;
    setIsSubmitting(false);
    setEvents([]);
    setEventsHydrated(false);
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    if (!eventsFetchSettled) return;
    if (eventsQueryError) {
      reset([]);
      latestEventIdRef.current = null;
    } else {
      const list = Array.isArray(bootstrappedEvents) ? bootstrappedEvents : [];
      reset(list);
      const last = list[list.length - 1];
      latestEventIdRef.current =
        last?.id && typeof last.id === "string" ? last.id : null;
    }
    setEventsHydrated(true);
  }, [
    conversationId,
    eventsFetchSettled,
    eventsQueryError,
    bootstrappedEvents,
    reset,
  ]);

  useEffect(() => {
    if (!eventsHydrated || !conversationId || !needLiveEvents) return;

    const ac = new AbortController();
    let isClosed = false;
    let reconnectTimer: number | undefined;

    const connect = async () => {
      if (isClosed || !conversationId || ac.signal.aborted) return;

      try {
        const response = await fetch(`${BASE_URL}/api/events`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-openbot-conversation-id": conversationId,
            "x-openbot-response-type": "stream",
            ...(latestEventIdRef.current ? { "x-openbot-after-id": latestEventIdRef.current } : {}),
          },
          body: JSON.stringify({ type: "conversations:subscribe" }),
          signal: ac.signal,
        });

        if (!response.ok) throw new Error(`Stream error: ${response.status}`);
        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done || isClosed || ac.signal.aborted) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              try {
                const chunk = JSON.parse(data);
                setEvents((prev) => mergeUniqueEvents(prev, [chunk]));
                if (chunk?.id && typeof chunk.id === "string") {
                  latestEventIdRef.current = chunk.id;
                }
                if (eventHandlers && eventHandlers[chunk.type]) {
                  void eventHandlers[chunk.type](chunk);
                }
                if (
                  eventHandlers &&
                  (chunk.type === "run:finished" || chunk.type === "run:cancelled" || chunk.type === "run:failed") &&
                  eventHandlers["stream:done"]
                ) {
                  void eventHandlers["stream:done"](chunk);
                }
              } catch (error) {
                console.error("Failed to parse stream event:", error);
              }
            }
          }
        }
      } catch (error) {
        if (ac.signal.aborted || isClosed) return;
        console.error("Stream connection failed:", error);
        reconnectTimer = window.setTimeout(connect, 1000);
      }
    };

    void connect();
    return () => {
      isClosed = true;
      ac.abort();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
    };
  }, [conversationId, eventHandlers, eventsHydrated, needLiveEvents]);

  useEffect(() => {
    const last = events[events.length - 1];
    const id = last?.id;
    if (id && typeof id === "string") latestEventIdRef.current = id;
  }, [events]);

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChat must be used within a ChatProvider");
  }

  return context;
}
