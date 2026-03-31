import { ChatProvider } from "./hooks/use-chat";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "./hooks/use-session";
import { useConfig } from "./hooks/use-config";
import { useConversations } from "./hooks/use-sessions";
import { cn } from "./lib/utils";
import { AppLayout, AppLayoutProvider } from "./components/layout/AppLayout";
import { ChatPage } from "./components/pages/ChatPage";
import { AutomationsPage } from "./components/pages/AutomationsPage";
import { SettingsPage } from "./components/pages/SettingsPage";
import { Onboarding } from "./components/Onboarding";
import { ThemeProvider } from "./components/ThemeProvider";
// import { BASE_URL } from "./lib/api";

export function App() {
  const queryClient = useQueryClient();
  const { conversationId, path, navigate, ensureConversationInUrl } = useSession();
  const { data: conversations = [] } = useConversations();
  const { data: config, isLoading: configLoading } = useConfig();
  const [sessionStateSidebarOpen, setSessionStateSidebarOpen] = useState(false);
  const activeConversationId = conversationId || conversations[0]?.id || "";

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
      },
    }),
    [queryClient, ensureConversationInUrl, activeConversationId]
  );

  const providerBody = useMemo(() => ({ conversationId: activeConversationId }), [activeConversationId]);

  useEffect(() => {
    if (!conversationId && activeConversationId) {
      ensureConversationInUrl(activeConversationId);
    }
  }, [conversationId, activeConversationId, ensureConversationInUrl]);

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
      initialAdditionalBody={providerBody}
      eventHandlers={eventHandlers}
    >
      <ThemeProvider>
        <AppLayoutProvider>
          <AppLayout
            conversationId={activeConversationId}
            currentTab={tab === "agents" ? "settings" : tab}
            onNavigate={navigate}
            rightActions={tab === "chat" ? (
              <button
                onClick={() => setSessionStateSidebarOpen((v) => !v)}
                className={cn(
                  "p-2 rounded-lg transition-all duration-150",
                  sessionStateSidebarOpen 
                    ? "bg-primary/10 text-primary" 
                    : "hover:bg-muted/80 text-muted-foreground/70 hover:text-foreground"
                )}
                aria-label={sessionStateSidebarOpen ? "Hide session data" : "Show session data"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M15 3v18" />
                </svg>
              </button>
            ) : null}
          >
            {tab === "chat" && activeConversationId && (
              <ChatPage conversationId={activeConversationId} showSidebar={sessionStateSidebarOpen} />
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
