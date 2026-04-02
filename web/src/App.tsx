import { ChatProvider } from "./hooks/use-chat";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "./hooks/use-session";
import { useConfig } from "./hooks/use-config";
import { useConversations } from "./hooks/use-sessions";
import { cn } from "./lib/utils";
import { api } from "./lib/api";
import { AppLayout, AppLayoutProvider } from "./components/layout/AppLayout";
import { ChatPage } from "./components/pages/ChatPage";
import { AutomationsPage } from "./components/pages/AutomationsPage";
import { SettingsPage } from "./components/pages/SettingsPage";
import { Onboarding } from "./components/Onboarding";
import { ThemeProvider } from "./components/ThemeProvider";
import { SessionStateSidebar } from "./components/SessionStateSidebar";
import { ThreadPanel } from "./components/ThreadPanel";

export function App() {
  const queryClient = useQueryClient();
  const { conversationId, path, navigate, ensureConversationInUrl } = useSession();
  const { data: conversations = [] } = useConversations();
  const { data: config, isLoading: configLoading } = useConfig();
  const [sessionStateSidebarOpen, setSessionStateSidebarOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const activeConversationId = conversationId || conversations[0]?.id || "";
  const markConversationRead = useCallback(
    async (id: string) => {
      if (!id) return;
      try {
        await api.markConversationRead(id);
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
      } catch (error) {
        console.error("Failed to mark conversation read:", error);
      }
    },
    [queryClient],
  );

  const tab = useMemo(() => {
    return new URLSearchParams(path).get("tab") || "chat";
  }, [path]);

  const eventHandlers = useMemo(
    () => ({
      "agent:input": async () => {
        ensureConversationInUrl(activeConversationId);
      },
      "client:invalidate": async (chunk: any) => {
        if (Array.isArray(chunk.data?.tags)) {
          queryClient.invalidateQueries({
            predicate: (query) => {
              const queryTags = (query.meta as any)?.tags as string[] | undefined;
              return queryTags?.some((tag) => chunk.data.tags.includes(tag)) ?? false;
            },
          });
        }
      },
      "stream:done": async () => {
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
        await markConversationRead(activeConversationId);
      },
    }),
    [queryClient, ensureConversationInUrl, activeConversationId, markConversationRead]
  );

  useEffect(() => {
    if (!conversationId && activeConversationId) {
      ensureConversationInUrl(activeConversationId);
    }
  }, [conversationId, activeConversationId, ensureConversationInUrl]);

  useEffect(() => {
    void markConversationRead(activeConversationId);
  }, [activeConversationId, markConversationRead]);

  useEffect(() => {
    const handleFocus = () => {
      void markConversationRead(activeConversationId);
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [activeConversationId, markConversationRead]);

  if (configLoading) return <LoadingScreen />;
  if (config && !config.configured) {
    return (
      <ThemeProvider>
        <Onboarding
          defaultModelId={config.defaultModelId}
          defaultModels={config.defaultModels}
        />
      </ThemeProvider>
    );
  }

  return (
    <ChatProvider
      conversationId={activeConversationId}
      eventHandlers={eventHandlers}
    >
      <ThemeProvider>
        <AppLayoutProvider>
          <AppLayout
            conversationId={activeConversationId}
            currentTab={tab === "agents" ? "settings" : tab}
            onNavigate={navigate}
            rightOpen={Boolean(activeThreadId || sessionStateSidebarOpen)}
            rightWidth={activeThreadId ? 450 : 300}
            rightSidebar={
              activeThreadId ? (
                <ThreadPanel
                  threadId={activeThreadId}
                  onClose={() => setActiveThreadId(null)}
                />
              ) : sessionStateSidebarOpen ? (
                <SessionStateSidebar />
              ) : null
            }
            rightActions={tab === "chat" ? (
              <button
                onClick={() => {
                  if (activeThreadId) {
                    setActiveThreadId(null);
                  } else {
                    setSessionStateSidebarOpen((v) => !v);
                  }
                }}
                className={cn(
                  "p-2 rounded-lg transition-all duration-150",
                  (activeThreadId || sessionStateSidebarOpen)
                    ? "bg-primary/10 text-primary" 
                    : "hover:bg-muted/80 text-muted-foreground/70 hover:text-foreground"
                )}
                aria-label={(activeThreadId || sessionStateSidebarOpen) ? "Hide right panel" : "Show right panel"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M15 3v18" />
                </svg>
              </button>
            ) : null}
          >
            {tab === "chat" && activeConversationId && (
              <ChatPage
                conversationId={activeConversationId}
                onReply={(id) => setActiveThreadId(id)}
              />
            )}
            {tab === "chat" && !activeConversationId && <NoConversationsPlaceholder />}
            {tab === "agents" && <SettingsPage defaultSection="agents" />}
            {tab === "automations" && <AutomationsPage />}
            {tab === "settings" && <SettingsPage />}
          </AppLayout>
        </AppLayoutProvider>
      </ThemeProvider>
    </ChatProvider>
  );
}

const LoadingScreen = () => (
  <div className="flex h-screen w-screen items-center justify-center">
    <div className="flex flex-col items-center gap-4 animate-fade-in">
      <div className="size-8 rounded-full border-2 border-foreground/10 border-t-foreground/60 animate-[spin-slow_0.8s_linear_infinite]" />
    </div>
  </div>
);

const NoConversationsPlaceholder = () => (
  <div className="flex h-full w-full items-center justify-center bg-background">
    <div className="text-center">
      <h2 className="text-base font-semibold text-foreground">No conversations yet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Create a channel or open a bot DM from the sidebar.
      </p>
    </div>
  </div>
);

export default App;
