import { MelonyProvider } from "@melony/react";
import { MelonyClient } from "melony/client";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "./hooks/use-session";
import { useConfig } from "./hooks/use-config";
import { cn } from "./lib/utils";
import { AppLayout, AppLayoutProvider } from "./components/layout/AppLayout";
import { ChatPage } from "./components/pages/ChatPage";
import { SessionStateSidebar } from "./components/SessionStateSidebar";
import { AgentsPage } from "./components/pages/AgentsPage";
import { AutomationsPage } from "./components/pages/AutomationsPage";
import { SettingsPage } from "./components/pages/SettingsPage";
import { Onboarding } from "./components/Onboarding";
import { ThemeProvider } from "./components/ThemeProvider";
import { BASE_URL } from "./lib/api";

const melonyClient = new MelonyClient({
  url: `${BASE_URL}/api/chat`,
});

export function App() {
  const queryClient = useQueryClient();
  const { sessionId, path, navigate, ensureSessionInUrl } = useSession();
  const { data: config, isLoading: configLoading } = useConfig();
  const [sessionStateSidebarOpen, setSessionStateSidebarOpen] = useState(true);

  const tab = useMemo(() => {
    return new URLSearchParams(path).get("tab") || "chat";
  }, [path]);

  const eventHandlers = useMemo(
    () => ({
      "agent:input": async (event: any, { client }: any) => {
        ensureSessionInUrl();
        const generator = client.send(event, { sessionId });
        const invalidateTags = new Set<string>();

        for await (const chunk of generator) {
          if (chunk?.type === "client:invalidate" && Array.isArray(chunk.data?.tags)) {
            chunk.data.tags.forEach((tag: string) => invalidateTags.add(tag));
          }
        }

        invalidateTags.add("sessions");
        queryClient.invalidateQueries({
          predicate: (query) => {
            const queryTags = (query.meta as any)?.tags as string[] | undefined;
            return queryTags?.some((tag) => invalidateTags.has(tag)) ?? false;
          },
        });
      },
    }),
    [sessionId, queryClient, ensureSessionInUrl]
  );

  const providerBody = useMemo(() => ({ sessionId }), [sessionId]);

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
    <MelonyProvider
      client={melonyClient}
      initialAdditionalBody={providerBody}
      eventHandlers={eventHandlers}
    >
      <ThemeProvider>
        <AppLayoutProvider>
          <AppLayout
            sessionId={sessionId}
            currentTab={tab}
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
            {tab === "chat" && <ChatPage sessionId={sessionId} showSidebar={sessionStateSidebarOpen} />}
            {tab === "agents" && <AgentsPage />}
            {tab === "automations" && <AutomationsPage />}
            {tab === "settings" && <SettingsPage />}
          </AppLayout>
        </AppLayoutProvider>
      </ThemeProvider>
    </MelonyProvider>
  );
}

const LoadingScreen = () => (
  <div className="flex h-screen w-screen items-center justify-center">
    <div className="flex flex-col items-center gap-4 animate-fade-in">
      <div className="size-8 rounded-full border-2 border-foreground/10 border-t-foreground/60 animate-[spin-slow_0.8s_linear_infinite]" />
    </div>
  </div>
);

export default App;
