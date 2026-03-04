import { useState, useCallback, type ReactNode } from "react";
import { SidebarContext, useSidebar } from "../../hooks/use-sidebar";
import { useSessions } from "../../hooks/use-sessions";
import { AppSidebar } from "./AppSidebar";
import { UpdateBadge } from "./UpdateBadge";

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
  const activeSession = sessions.find((session) => session.id === sessionId);
  const headerTitle = activeSession?.title || sessionId.slice(0, 12);

  return (
    <div className="flex h-screen w-screen overflow-hidden text-foreground bg-muted/30">
      <aside
        className="h-full shrink-0 transition-[width] duration-300 ease-in-out overflow-hidden"
        style={{ width: open ? SIDEBAR_WIDTH : 0 }}
      >
        <div className="h-full" style={{ width: SIDEBAR_WIDTH }}>
          <AppSidebar
            sessionId={sessionId}
            currentTab={currentTab}
            onNavigate={onNavigate}
          />
        </div>
      </aside>

      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0 bg-background">
        <div className="flex items-center justify-between px-3 py-2 gap-1 border-b border-border/50">
          <div className="flex items-center gap-1">
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
            <div className="ml-2 flex items-center">
              <UpdateBadge />
            </div>
            {currentTab === "chat" && (
              <h1 className="ml-2 text-sm font-medium text-foreground/85 truncate max-w-[55vw]">
                {headerTitle}
              </h1>
            )}
          </div>
          <div className="flex items-center gap-1">{rightActions}</div>
        </div>

        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
