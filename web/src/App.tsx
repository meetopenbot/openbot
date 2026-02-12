import { MelonyProvider, useMelony } from "@melony/react";
import { MelonyRenderer, MelonyUIProvider, type UINode } from "@melony/ui-kit";
import { shadcnElements, ThemeProvider } from "@melony/ui-shadcn";
import { generateId, MelonyClient } from "melony/client";
import { useEffect, useMemo, useState, useRef } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";

const BASE_URL = (window as any).MELONY_BASE_URL || "http://localhost:4001";

const melonyClient = new MelonyClient({
  url: `${BASE_URL}/api/chat`,
})

export function App() {
  const [context, setContext] = useState<Record<string, any>>({
    sidebarWidth: 240,
    isSidebarOpen: true,
  });
  const [path, setPath] = useState(window.location.search);

  const sessionId = useMemo(() => {
    const params = new URLSearchParams(path);
    return params.get("sessionId") || `ses_${generateId()}`;
  }, [path]);

  useEffect(() => {
    const handlePopState = () => {
      setPath(window.location.search);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return (
    <MelonyProvider
      client={melonyClient}
      initialAdditionalBody={{
        sessionId
      }}
      eventHandlers={{
        "client:navigate": (event) => {
          console.log("Navigating to:", event.data.path);
          // push without reloading the page
          window.history.pushState({}, "", event.data.path);
          setPath(window.location.search);
          return;
        },
        "client:set-context": (event) => {
          setContext({ ...context, ...event.data });
          return;
        },
        "user:text": async (event, { client }) => {
          const params = new URLSearchParams(window.location.search);
          if (!params.has("sessionId")) {
            params.set("sessionId", sessionId);
            const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
            window.history.replaceState({}, "", newUrl);
            setPath(window.location.search);
          }

          const generator = client.send(event, { sessionId });
          for await (const _ of generator) {
            // Events are handled by the client subscription
          }
        },
      }}
    >
      <MelonyUIProvider components={{ ...shadcnElements }}>
        <ThemeProvider>
          <AppContent sessionId={sessionId} path={path} />
        </ThemeProvider>
      </MelonyUIProvider>
    </MelonyProvider>
  )
}

export function AppContent({ sessionId, path }: { sessionId: string, path: string }) {
  const { reset } = useMelony();
  const [loadedSessions, setLoadedSessions] = useState<Set<string>>(new Set());
  
  // Stable UI parts
  const [sidebarUI, setSidebarUI] = useState<UINode | null>(null);
  const [contentUI, setContentUI] = useState<UINode | null>(null);

  // Track previous values to determine event type
  const prevSessionIdRef = useRef<string>(sessionId);
  const prevTabRef = useRef<string | undefined>(undefined);

  const searchParams = new URLSearchParams(path);
  const tab = searchParams.get("tab") || "chat";

  const { data, isLoading: loading, error } = useQuery({
    queryKey: ["view", sessionId, tab],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const isFirstLoad = !prevTabRef.current;
      const isSessionChange = prevSessionIdRef.current !== sessionId;
      const isTabChange = !isFirstLoad && !isSessionChange && prevTabRef.current !== tab;

      let type = "init";
      if (isSessionChange) type = "sessionChange";
      else if (isTabChange) type = "tabChange";

      const history = !loadedSessions.has(sessionId);
      const params = new URLSearchParams({
        type,
        data: JSON.stringify({
          sessionId,
          history,
          platform: "web",
          tab,
        })
      });
      
      // Update refs
      prevSessionIdRef.current = sessionId;
      prevTabRef.current = tab;

      const response = await fetch(`${BASE_URL}/api/view?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch view: ${response.statusText}`);
      }
      return response.json();
    }
  });

  useEffect(() => {
    if (data) {
      if (data.initialEvents) {
        reset(data.initialEvents);
        setLoadedSessions(prev => new Set(prev).add(sessionId));
      }
      
      // Update UI parts independently
      if (data.sidebar) setSidebarUI(data.sidebar);
      if (data.content) setContentUI(data.content);
      
      // Fallback for full layout
      if (data.ui && !data.sidebar && !data.content) {
        setContentUI(data.ui);
      }
    }
  }, [data, sessionId, reset]);

  if (loading && !sidebarUI && !contentUI) {
    return <div style={{ fontSize: "11px", fontWeight: "bold", height: "100%", width: "100%", display: "flex", justifyContent: "center", alignItems: "center" }}>Loading...</div>;
  }

  if (error && !sidebarUI && !contentUI) {
    return <div style={{ fontSize: "11px", fontWeight: "bold", height: "100%", width: "100%", display: "flex", justifyContent: "center", alignItems: "center" }}>Failed to load UI</div>;
  }

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      {sidebarUI && (
        <MelonyRenderer node={sidebarUI} />
      )}
      <div style={{ flex: 1, height: "100%", overflow: "hidden" }}>
        {contentUI && (
          <MelonyRenderer node={contentUI} />
        )}
      </div>
    </div>
  );
}


export default App
