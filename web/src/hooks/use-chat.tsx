import React, { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from "react";
import { ChatClient } from "../lib/chat-client";
import { BASE_URL } from "../lib/api";

/** Fold raw thread events into user/assistant messages (matches channel transcript rules). */
export function foldThreadEventsToMessages(events: any[]): any[] {
  return events.reduce((msgs: any[], event: any) => {
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

interface ChatContextType {
  send: (payload: any) => Promise<void>;
  stop: (threadId?: string) => void;
  streaming: boolean;
  streamingMap: Record<string, boolean>;
  events: any[];
  messages: any[];
  threads: Record<string, any[]>;
  threadReplyCounts: Record<string, number>;
  reset: (events: any[]) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ 
  children, 
  conversationId, 
  eventHandlers,
  initialAdditionalBody 
}: { 
  children: React.ReactNode; 
  conversationId: string; 
  eventHandlers?: Record<string, (chunk: any, context: { client: ChatClient }) => Promise<void>>;
  initialAdditionalBody?: Record<string, any>;
}) {
  const [events, setEvents] = useState<any[]>([]);
  const [streamingMap, setStreamingMap] = useState<Record<string, boolean>>({});
  const streamingRef = useRef<Record<string, boolean>>({});
  const client = useMemo(() => new ChatClient({ url: `${BASE_URL}/api/chat` }), []);

  // Update ref when state changes
  useEffect(() => {
    streamingRef.current = streamingMap;
  }, [streamingMap]);

  // Compute streaming as a shorthand for main window (no threadId)
  const streaming = useMemo(() => streamingMap["main"] || false, [streamingMap]);

  // Compute messages and threads from events
  const { messages, threads } = useMemo(() => {
    const msgs: any[] = [];
    const threadMap: Record<string, any[]> = {};
    let currentMsg: any = null;
    const seenIds = new Set<string>();

    events.forEach((event) => {
      if (event.id && seenIds.has(event.id)) return;
      if (event.id) seenIds.add(event.id);

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

    return { messages: msgs, threads: threadMap };
  }, [events]);

  const threadReplyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [id, evts] of Object.entries(threads)) {
      counts[id] = foldThreadEventsToMessages(evts).length;
    }
    return counts;
  }, [threads]);

  const reset = useCallback((newEvents: any[]) => {
    setEvents(newEvents);
  }, []);

  const send = useCallback(async (payload: any) => {
    const threadId = payload.meta?.threadId || "main";
    if (streamingRef.current[threadId]) return;
    
    setStreamingMap(prev => ({ ...prev, [threadId]: true }));
    // Ensure we have a stable ID for deduplication
    const eventWithId = {
      ...payload,
      id: payload.id || Math.random().toString(36).substring(7),
      timestamp: Date.now()
    };

    // Add the user input event immediately for UX
    setEvents(prev => [...prev, eventWithId]);

    try {
      const generator = client.send(eventWithId, { 
        conversationId,
        requestId: threadId,
        ...initialAdditionalBody
      });

      for await (const chunk of generator) {
        setEvents(prev => [...prev, chunk]);
        
        // Call handler for the chunk type itself (e.g. client:invalidate)
        if (eventHandlers && eventHandlers[chunk.type]) {
          await eventHandlers[chunk.type](chunk, { client });
        }
        
        // Call handler for the original payload type (legacy behavior)
        if (eventHandlers && eventHandlers[payload.type] && payload.type !== chunk.type) {
          await eventHandlers[payload.type](chunk, { client });
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        console.log("Chat stream aborted");
      } else {
        console.error("Chat stream error:", error);
      }
    } finally {
      setStreamingMap(prev => ({ ...prev, [threadId]: false }));
      if (eventHandlers && eventHandlers["stream:done"]) {
        await eventHandlers["stream:done"]({}, { client });
      }
    }
  }, [client, conversationId, eventHandlers, initialAdditionalBody]);

  const stop = useCallback((threadId?: string) => {
    client.stop(threadId || "main");
    setStreamingMap(prev => ({ ...prev, [threadId || "main"]: false }));
  }, [client]);

  const value = useMemo(() => ({
    send,
    stop,
    streaming,
    streamingMap,
    events,
    messages,
    threads,
    threadReplyCounts,
    reset
  }), [send, stop, streaming, streamingMap, events, messages, threads, threadReplyCounts, reset]);

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
