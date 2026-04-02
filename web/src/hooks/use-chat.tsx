import React, { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from "react";
import { api } from "../lib/api";

/** Fold raw thread events into user/assistant messages (matches channel transcript rules). */
export function foldThreadEventsToMessages(events: any[]): any[] {
  return events.reduce((msgs: any[], event: any) => {
    if (event.type === "message:reaction") return msgs;
    const currentMsg = msgs[msgs.length - 1];
    if (event.type === "agent:input" || event.type === "user:input") {
      msgs.push({
        id: event.id || `thread-user-${msgs.length}`,
        role: "user",
        content: [event],
      });
    } else if (currentMsg?.role === "assistant") {
      currentMsg.content.push(event);
    } else {
      msgs.push({
        id: event.id || `thread-asst-${msgs.length}`,
        role: "assistant",
        content: [event],
      });
    }
    return msgs;
  }, []);
}

export type MessageReactionSentiment = "like" | "dislike";

interface ChatContextType {
  send: (payload: any) => Promise<void>;
  stop: (threadId?: string) => void;
  streaming: boolean;
  streamingMap: Record<string, boolean>;
  events: any[];
  messages: any[];
  threads: Record<string, any[]>;
  threadReplyCounts: Record<string, number>;
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
  const [submittingByThread, setSubmittingByThread] = useState<Record<string, boolean>>({});
  const latestEventIdRef = useRef<string | null>(null);

  const threadRunsMap = useMemo(() => {
    const active = new Map<string, string>();
    for (const event of events) {
      if (!event || typeof event !== "object") continue;
      const runId = event.data?.runId;
      if (!runId || typeof runId !== "string") continue;
      const threadId = event.meta?.threadId || "main";
      if (event.type === "run:started") active.set(threadId, runId);
      if (
        event.type === "run:finished" ||
        event.type === "run:cancelled" ||
        event.type === "run:failed"
      ) {
        if (active.get(threadId) === runId) active.delete(threadId);
      }
    }
    return active;
  }, [events]);

  const streamingMap = useMemo(() => {
    const next: Record<string, boolean> = { ...submittingByThread };
    threadRunsMap.forEach((_runId, threadId) => {
      next[threadId] = true;
    });
    return next;
  }, [threadRunsMap, submittingByThread]);

  const streaming = useMemo(() => streamingMap["main"] || false, [streamingMap]);

  // Compute messages, threads, and reaction map from events
  const { messages, threads, messageReactions } = useMemo(() => {
    const msgs: any[] = [];
    const threadMap: Record<string, any[]> = {};
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

      const threadId = event.meta?.threadId;
      if (threadId) {
        if (!threadMap[threadId]) threadMap[threadId] = [];
        threadMap[threadId].push(event);
        return; // Skip adding to main messages
      }

      if (event.type === "agent:input" || event.type === "user:input") {
        currentMsg = {
          id: event.id || Math.random().toString(36).substring(7),
          runId: event.runId || event.meta?.runId,
          role: "user",
          content: [event],
        };
        msgs.push(currentMsg);
      } else if (currentMsg?.role === "assistant") {
        currentMsg.content.push(event);
      } else {
        // Assistant turn (stream chunks, UI, etc.) — must not merge into the user message
        currentMsg = {
          id: event.id || `asst_${Math.random().toString(36).slice(2, 9)}`,
          runId: event.runId || event.meta?.runId,
          role: "assistant",
          content: [event],
        };
        msgs.push(currentMsg);
      }
    });

    return { messages: msgs, threads: threadMap, messageReactions: reactions };
  }, [events]);

  const threadReplyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [id, evts] of Object.entries(threads)) {
      counts[id] = foldThreadEventsToMessages(evts).length;
    }
    return counts;
  }, [threads]);

  const reset = useCallback((newEvents: any[]) => {
    setEvents(mergeUniqueEvents([], newEvents));
  }, []);

  const send = useCallback(async (payload: any) => {
    const threadId = payload.meta?.threadId || "main";
    if (streamingMap[threadId]) return;
    setSubmittingByThread((prev) => ({ ...prev, [threadId]: true }));

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
      setSubmittingByThread((prev) => ({ ...prev, [threadId]: false }));
    }
  }, [conversationId, eventHandlers, streamingMap]);

  const stop = useCallback((threadId?: string) => {
    const id = threadId || "main";
    const runId = threadRunsMap.get(id);
    if (!runId) return;
    void api.cancelRun(runId).catch((err) => {
      console.error("Failed to cancel run:", err);
    });
  }, [threadRunsMap]);

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
    streamingMap,
    events,
    messages,
    threads,
    threadReplyCounts,
    messageReactions,
    setMessageReaction,
    reset
  }), [send, stop, streaming, streamingMap, events, messages, threads, threadReplyCounts, messageReactions, setMessageReaction, reset]);

  useEffect(() => {
    latestEventIdRef.current = null;
    setSubmittingByThread({});
    setEvents([]);
  }, [conversationId]);

  useEffect(() => {
    let isClosed = false;
    let reconnectTimer: number | undefined;
    let source: EventSource | undefined;

    const connect = () => {
      if (isClosed || !conversationId) return;
      const url = api.getConversationStreamUrl(conversationId, latestEventIdRef.current ?? undefined);
      source = new EventSource(url);

      source.onmessage = (message) => {
        if (!message.data) return;
        try {
          const chunk = JSON.parse(message.data);
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
      };

      source.onerror = () => {
        source?.close();
        if (!isClosed) reconnectTimer = window.setTimeout(connect, 1000);
      };
    };

    connect();
    return () => {
      isClosed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [conversationId, eventHandlers]);

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

export function useChat(threadId?: string) {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChat must be used within a ChatProvider");
  }

  const tid = threadId || "main";
  const streaming = context.streamingMap[tid] || false;

  return {
    ...context,
    streaming,
    stop: (id?: string) => context.stop(id || threadId)
  };
}
