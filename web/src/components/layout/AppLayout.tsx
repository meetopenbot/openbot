import { useState, useCallback, type ReactNode } from 'react';
import { SidebarContext, useSidebar } from '../../hooks/use-sidebar';
import { useConversations } from '../../hooks/use-sessions';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { AppSidebar } from './AppSidebar';
import { UpdateBadge } from './UpdateBadge';
import { AgentAvatar } from '../AgentAvatar';
import { cn } from '../../lib/utils';

const SIDEBAR_WIDTH = 272;

import { SettingsSidebar, type SettingsSection } from './SettingsSidebar';

interface AppLayoutProps {
  children: ReactNode;
  conversationId: string;
  currentTab: string;
  onNavigate: (path: string) => void;
  rightActions?: ReactNode;
  rightSidebar?: ReactNode;
  rightWidth?: number;
  /** Tailwind width classes when open (e.g. `w-[450px] xl:w-[600px]`). When set, overrides numeric `rightWidth` for the rail. */
  rightWidthClassName?: string;
  rightOpen?: boolean;
  onHeaderClick?: () => void;
  settingsSection?: SettingsSection;
  onSettingsSectionChange?: (section: SettingsSection) => void;
}

export function AppLayoutProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const toggleRight = useCallback(() => setRightOpen((v) => !v), []);

  return (
    <SidebarContext.Provider
      value={{ open, toggle, setOpen, rightOpen, toggleRight, setRightOpen }}
    >
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
  rightWidthClassName,
  rightOpen,
  onHeaderClick,
  settingsSection,
  onSettingsSectionChange,
}: AppLayoutProps) {
  const rightRailUsesClasses = Boolean(rightWidthClassName);
  const { open, toggle } = useSidebar();
  const { data: conversations = [] } = useConversations();
  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: api.getAgents,
  });

  const activeConversation = conversations.find(
    (conversation) => conversation.id === conversationId,
  );
  const dmAgentIdFromRoute = conversationId.startsWith('dm_') ? conversationId.slice(3) : undefined;
  const resolvedDmAgentId =
    activeConversation?.kind === 'dm' && activeConversation.agentId
      ? activeConversation.agentId
      : dmAgentIdFromRoute;
  const activeAgent = resolvedDmAgentId
    ? agents.find((a) => a.id === resolvedDmAgentId || a.name === resolvedDmAgentId)
    : null;

  let headerTitle = activeConversation?.title || conversationId;
  if (activeAgent && !activeConversation?.title) {
    headerTitle = activeAgent.name;
  }

  if (currentTab === 'settings' && settingsSection) {
    headerTitle = settingsSection.charAt(0).toUpperCase() + settingsSection.slice(1);
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden text-foreground bg-background">
      <aside
        className="h-full shrink-0 transition-[width] duration-300 ease-in-out overflow-hidden"
        style={{ width: open ? SIDEBAR_WIDTH : 0 }}
      >
        <div className="h-full bg-background" style={{ width: SIDEBAR_WIDTH }}>
          {currentTab === 'settings' && settingsSection && onSettingsSectionChange ? (
            <SettingsSidebar
              currentSection={settingsSection}
              onSectionChange={onSettingsSectionChange}
              onBack={() => onNavigate('/')}
            />
          ) : (
            <AppSidebar
              conversationId={conversationId}
              currentTab={currentTab}
              onNavigate={onNavigate}
            />
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0 bg-background">
        <div className="flex items-center justify-between px-4 h-14 gap-1 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-1 min-w-0">
            <button
              onClick={toggle}
              className="p-2 rounded-sm hover:bg-muted text-muted-foreground/80 hover:text-foreground transition-colors"
              aria-label={open ? 'Collapse sidebar' : 'Open sidebar'}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
            <div className="flex items-center shrink-0">
              <UpdateBadge />
            </div>
            {currentTab === 'chat' && (
              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={onHeaderClick}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-muted transition-colors group min-w-0 text-left"
                >
                  {activeAgent && (
                    <AgentAvatar
                      name={activeAgent.isDefault ? 'default' : activeAgent.id}
                      label={activeAgent.name}
                      imageUrl={activeAgent.image}
                      className="size-5 shrink-0 rounded-md shadow-sm group-hover:scale-105 transition-transform"
                    />
                  )}
                  <h1 className="text-sm font-semibold text-foreground/85 truncate max-w-[55vw]">
                    {headerTitle}
                  </h1>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-muted-foreground/40 group-hover:text-muted-foreground/80 transition-colors"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              </div>
            )}
            {currentTab === 'settings' && (
              <div className="flex items-center gap-2 min-w-0 ml-1">
                <h1 className="text-sm font-semibold text-foreground/85 truncate">
                  {headerTitle}
                </h1>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {rightActions}
          </div>
        </div>

        <main className="flex-1 overflow-hidden">{children}</main>
      </div>

      <aside
        className={cn(
          'h-full shrink-0 overflow-hidden hidden lg:block border-l border-border/50 bg-background transition-[width] duration-300 ease-in-out',
          rightRailUsesClasses && (rightOpen ? rightWidthClassName : 'w-0'),
        )}
        style={
          rightRailUsesClasses ? undefined : { width: rightOpen ? rightWidth : 0 }
        }
      >
        <div
          className={cn('h-full', rightRailUsesClasses && 'w-full min-w-0')}
          style={rightRailUsesClasses ? undefined : { width: rightWidth }}
        >
          {rightSidebar}
        </div>
      </aside>

    </div>
  );
}
