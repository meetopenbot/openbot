import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import { ChatClient } from "../lib/chat-client";
import { BASE_URL } from "../lib/api";

interface ChatContextType {
  send: (payload: any) => Promise<void>;
  stop: () => void;
  streaming: boolean;
  events: any[];
  messages: any[];
  reset: (events: any[]) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ 
  children, 
  sessionId, 
  eventHandlers,
  initialAdditionalBody 
}: { 
  children: React.ReactNode; 
  sessionId: string; 
  eventHandlers?: Record<string, (chunk: any, context: { client: ChatClient }) => Promise<void>>;
  initialAdditionalBody?: Record<string, any>;
}) {
  const [events, setEvents] = useState<any[]>([]);
  const [streaming, setStreaming] = useState(false);
  const client = useMemo(() => new ChatClient({ url: `${BASE_URL}/api/chat` }), []);

  // Compute messages from events
  const messages = useMemo(() => {
    const msgs: any[] = [];
    let currentMsg: any = null;
    const seenIds = new Set<string>();

    events.forEach((event) => {
      if (event.id && seenIds.has(event.id)) return;
      if (event.id) seenIds.add(event.id);

      if (event.type === "agent:input" || event.type === "user:input") {
        currentMsg = {
          id: event.id || Math.random().toString(36).substring(7),
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
          role: "assistant",
          content: [event],
        };
        msgs.push(currentMsg);
      }
    });

    return msgs;
  }, [events]);

  const reset = useCallback((newEvents: any[]) => {
    setEvents(newEvents);
  }, []);

  const send = useCallback(async (payload: any) => {
    if (streaming) return;
    
    setStreaming(true);
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
        sessionId,
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
      setStreaming(false);
      if (eventHandlers && eventHandlers["stream:done"]) {
        await eventHandlers["stream:done"]({}, { client });
      }
    }
  }, [client, sessionId, eventHandlers, initialAdditionalBody, streaming]);

  const stop = useCallback(() => {
    client.stop();
    setStreaming(false);
  }, [client]);

  const value = useMemo(() => ({
    send,
    stop,
    streaming,
    events,
    messages,
    reset
  }), [send, stop, streaming, events, messages, reset]);

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
