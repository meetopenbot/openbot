import { useState, useCallback, type ReactNode } from "react";
import { SidebarContext, useSidebar } from "../../hooks/use-sidebar";
import { useSessions } from "../../hooks/use-sessions";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { AppSidebar } from "./AppSidebar";
import { UpdateBadge } from "./UpdateBadge";
import { AgentAvatar } from "../AgentAvatar";
import { AgentProfileModal } from "../AgentProfileModal";

const SIDEBAR_WIDTH = 272;

interface AppLayoutProps {
  children: ReactNode;
  sessionId: string;
  currentTab: string;
  onNavigate: (path: string) => void;
  rightActions?: ReactNode;
}

export function AppLayoutProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <SidebarContext.Provider value={{ open, toggle, setOpen }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function AppLayout({ children, sessionId, currentTab, onNavigate, rightActions }: AppLayoutProps) {
  const { open, toggle } = useSidebar();
  const { data: sessions = [] } = useSessions();
  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
  });

  const [showAgentProfile, setShowAgentProfile] = useState(false);

  const activeSession = sessions.find((session) => session.id === sessionId);
  
  // Find agent if this is an agent session
  const agentIdFromSessionId = sessionId.startsWith('agent_') ? sessionId.slice(6) : null;
  const activeAgent = agents.find(a => a.id === agentIdFromSessionId || a.name === agentIdFromSessionId);

  let headerTitle = activeSession?.title || (sessionId.startsWith('agent_') ? `@${sessionId.slice(6)}` : sessionId.slice(0, 12));
  if (activeAgent && !activeSession?.title) {
    headerTitle = activeAgent.name;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden text-foreground bg-muted/30">
      <aside
        className="h-full shrink-0 transition-[width] duration-300 ease-in-out overflow-hidden"
        style={{ width: open ? SIDEBAR_WIDTH : 0 }}
      >
        <div className="h-full bg-background" style={{ width: SIDEBAR_WIDTH }}>
          <AppSidebar
            sessionId={sessionId}
            currentTab={currentTab}
            onNavigate={onNavigate}
          />
        </div>
      </aside>

      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0 bg-background">
        <div className="flex items-center justify-between px-3 py-2 gap-1 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-1 min-w-0">
            <button
              onClick={toggle}
              className="p-2 rounded-lg hover:bg-muted/80 text-muted-foreground/70 hover:text-foreground transition-all duration-150"
              aria-label={open ? "Collapse sidebar" : "Open sidebar"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
            <button
              onClick={() => onNavigate("/")}
              className="p-2 rounded-lg hover:bg-muted/80 text-muted-foreground/70 hover:text-foreground transition-all duration-150"
              aria-label="New chat"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
            </button>
            <div className="ml-2 flex items-center shrink-0">
              <UpdateBadge />
            </div>
            {currentTab === "chat" && (
              <div className="flex items-center gap-2 min-w-0">
                {activeAgent ? (
                  <button
                    onClick={() => setShowAgentProfile(true)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-muted/80 transition-all duration-150 group min-w-0"
                  >
                    <AgentAvatar 
                      name={activeAgent.isDefault ? "default" : activeAgent.name} 
                      className="size-6 shrink-0 rounded-lg shadow-sm group-hover:scale-105 transition-transform" 
                    />
                    <h1 className="text-sm font-semibold text-foreground/85 truncate max-w-[55vw]">
                      {headerTitle}
                    </h1>
                    <svg 
                      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      className="text-muted-foreground/40 group-hover:text-muted-foreground/80 transition-colors"
                    >
                      <path d="m6 9 6 6 6-6"/>
                    </svg>
                  </button>
                ) : (
                  <h1 className="ml-2 text-sm font-medium text-foreground/85 truncate max-w-[55vw]">
                    {headerTitle}
                  </h1>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">{rightActions}</div>
        </div>

        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>

      {showAgentProfile && activeAgent && (
        <AgentProfileModal
          agent={activeAgent}
          onClose={() => setShowAgentProfile(false)}
        />
      )}
    </div>
  );
}
