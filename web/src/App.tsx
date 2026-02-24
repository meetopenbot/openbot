import { MelonyProvider } from "@melony/react";
import { MelonyUIProvider } from "@melony/ui-kit";
import { shadcnElements, ThemeProvider } from "@melony/ui-shadcn";
import { MelonyClient } from "melony/client";
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "./hooks/use-session";
import { useConfig } from "./hooks/use-config";
import { AppLayout, AppLayoutProvider } from "./components/layout/AppLayout";
import { ChatPage } from "./components/pages/ChatPage";
import { AgentsPage } from "./components/pages/AgentsPage";
import { SettingsPage } from "./components/pages/SettingsPage";
import { Onboarding } from "./components/Onboarding";
import { Thread } from "./components/Thread";
import { Composer } from "./components/Composer";
import { BASE_URL } from "./lib/api";

const melonyClient = new MelonyClient({
  url: `${BASE_URL}/api/chat`,
});

export function App() {
  const queryClient = useQueryClient();
  const { sessionId, path, navigate, ensureSessionInUrl } = useSession();
  const { data: config, isLoading: configLoading } = useConfig();

  const tab = useMemo(() => {
    return new URLSearchParams(path).get("tab") || "chat";
  }, [path]);

  const eventHandlers = useMemo(
    () => ({
      "user:text": async (event: any, { client }: any) => {
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
      "user:multimodal": async (event: any, { client }: any) => {
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

  const components = useMemo(
    () => ({
      ...shadcnElements,
      thread: Thread,
      composer: Composer,
    }),
    []
  );

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
      <MelonyUIProvider components={components}>
        <ThemeProvider>
          <AppLayoutProvider>
            <AppLayout
              sessionId={sessionId}
              currentTab={tab}
              onNavigate={navigate}
            >
              {tab === "chat" && <ChatPage sessionId={sessionId} />}
              {tab === "agents" && <AgentsPage />}
              {tab === "settings" && <SettingsPage />}
            </AppLayout>
          </AppLayoutProvider>
        </ThemeProvider>
      </MelonyUIProvider>
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
