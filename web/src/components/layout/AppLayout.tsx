import { useState, useCallback, type ReactNode } from "react";
import { SidebarContext, useSidebar } from "../../hooks/use-sidebar";
import { useConversations } from "../../hooks/use-sessions";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { AppSidebar } from "./AppSidebar";
import { UpdateBadge } from "./UpdateBadge";
import { AgentAvatar } from "../AgentAvatar";
import { AgentProfileModal } from "../AgentProfileModal";
import { ChannelMembersDialog } from "../ChannelMembersDialog";

const SIDEBAR_WIDTH = 272;

interface AppLayoutProps {
  children: ReactNode;
  conversationId: string;
  currentTab: string;
  onNavigate: (path: string) => void;
  rightActions?: ReactNode;
  rightSidebar?: ReactNode;
  rightWidth?: number;
  rightOpen?: boolean;
}

export function AppLayoutProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const toggleRight = useCallback(() => setRightOpen((v) => !v), []);

  return (
    <SidebarContext.Provider value={{ open, toggle, setOpen, rightOpen, toggleRight, setRightOpen }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function AppLayout({
  children,
  conversationId,
  currentTab,
  onNavigate,
  rightActions,
  rightSidebar,
  rightWidth = 300,
  rightOpen,
}: AppLayoutProps) {
  const { open, toggle } = useSidebar();
  const { data: conversations = [] } = useConversations();
  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
  });

  const [showAgentProfile, setShowAgentProfile] = useState(false);
  const [showChannelMembers, setShowChannelMembers] = useState(false);

  const activeConversation = conversations.find((conversation) => conversation.id === conversationId);
  const isChannelConversation = activeConversation?.kind === "channel";
  const activeAgent = activeConversation?.kind === "dm" && activeConversation.agentId
    ? agents.find(a => a.id === activeConversation.agentId || a.name === activeConversation.agentId)
    : null;
  const { data: channelMembers } = useQuery({
    queryKey: ["channel-members", conversationId],
    queryFn: () => api.getChannelMembers(conversationId),
    enabled: !!isChannelConversation,
  });

  let headerTitle = activeConversation?.title || conversationId;
  if (activeAgent && !activeConversation?.title) {
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
            conversationId={conversationId}
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
            <div className="flex items-center shrink-0">
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
                      className="size-5 shrink-0 rounded shadow-sm group-hover:scale-105 transition-transform" 
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
                  <div className="ml-2 flex items-center gap-2 min-w-0">
                    <h1 className="text-sm font-medium text-foreground/85 truncate max-w-[40vw]">
                      {headerTitle}
                    </h1>
                    {isChannelConversation && (
                      <button
                        type="button"
                        onClick={() => setShowChannelMembers(true)}
                        className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border/60 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="8.5" cy="7" r="4" />
                          <path d="M20 8v6" />
                          <path d="M23 11h-6" />
                        </svg>
                        <span>
                          {channelMembers?.members.length ?? 1}
                        </span>
                      </button>
                    )}
                  </div>
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

      <aside
        className="h-full shrink-0 transition-[width] duration-300 ease-in-out overflow-hidden hidden lg:block border-l border-border/50 bg-background"
        style={{ width: rightOpen ? rightWidth : 0 }}
      >
        <div className="h-full" style={{ width: rightWidth }}>
          {rightSidebar}
        </div>
      </aside>

      {showAgentProfile && activeAgent && (
        <AgentProfileModal
          agent={activeAgent}
          onClose={() => setShowAgentProfile(false)}
        />
      )}
      {showChannelMembers && isChannelConversation && (
        <ChannelMembersDialog
          channelId={conversationId}
          channelName={activeConversation?.title || conversationId.replace("channel_", "")}
          onClose={() => setShowChannelMembers(false)}
        />
      )}
    </div>
  );
}
