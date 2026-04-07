import { useMemo } from 'react';
import { ChatProvider } from './hooks/use-chat';
import { useCallback, useEffect } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useSession } from './hooks/use-session';
import { useConfig } from './hooks/use-config';
import { useConversations } from './hooks/use-sessions';
import { api } from './lib/api';
import { AppLayout, AppLayoutProvider } from './components/layout/AppLayout';
import { ChatPage } from './components/pages/ChatPage';
import { AutomationsPage } from './components/pages/AutomationsPage';
import { SettingsPage } from './components/pages/SettingsPage';
import { Onboarding } from './components/Onboarding';
import { ThemeProvider } from './components/ThemeProvider';
import { ChannelSpecSidebar } from './components/ChannelSpecSidebar';
import { AgentProfileSidebar } from './components/AgentProfileSidebar';
import { Button } from './components/ui/button';
import { InfoIcon } from 'lucide-react';
import type { SettingsSection } from './components/layout/SettingsSidebar';
import { useSidebar } from './hooks/use-sidebar';

export function App() {
  const queryClient = useQueryClient();
  const { conversationId, path, navigate, ensureConversationInUrl } = useSession();
  const { data: conversations = [] } = useConversations();
  const { data: config, isLoading: configLoading } = useConfig();
  const { data: agents = [] } = useQuery({ queryKey: ['agents'], queryFn: api.getAgents });

  return (
    <ThemeProvider>
      <AppLayoutProvider>
        <AppContent
          queryClient={queryClient}
          conversationId={conversationId}
          path={path}
          navigate={navigate}
          ensureConversationInUrl={ensureConversationInUrl}
          conversations={conversations}
          config={config}
          configLoading={configLoading}
          agents={agents}
        />
      </AppLayoutProvider>
    </ThemeProvider>
  );
}

function AppContent({
  queryClient,
  conversationId,
  path,
  navigate,
  ensureConversationInUrl,
  conversations,
  config,
  configLoading,
  agents,
}: any) {
  const { rightPanel, setRightPanel } = useSidebar();

  const defaultAgent = agents.find((a: any) => a.isDefault);
  const activeConversationId =
    conversationId ||
    (defaultAgent
      ? `dm_${defaultAgent.id || defaultAgent.name}`
      : conversations[0]?.id || '');

  const activeConversation = conversations.find((c: any) => c.id === activeConversationId);
  const dmAgentIdFromRoute = activeConversationId.startsWith('dm_')
    ? activeConversationId.slice(3)
    : undefined;
  const resolvedDmAgentId =
    activeConversation?.kind === 'dm' && activeConversation.agentId
      ? activeConversation.agentId
      : dmAgentIdFromRoute;
  const activeAgent = resolvedDmAgentId
    ? agents.find((a: any) => a.id === resolvedDmAgentId || a.name === resolvedDmAgentId)
    : null;

  const markConversationRead = useCallback(
    async (id: string) => {
      if (!id) return;
      try {
        await api.markConversationRead(id);
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
      } catch (error) {
        console.error('Failed to mark conversation read:', error);
      }
    },
    [queryClient],
  );

  const tab = useMemo(() => {
    return new URLSearchParams(path).get('tab') || 'chat';
  }, [path]);

  const settingsSection = useMemo(() => {
    const params = new URLSearchParams(path);
    const section = params.get('settingsSection');
    return (section as SettingsSection) || 'general';
  }, [path]);

  const setSettingsSection = useCallback(
    (section: SettingsSection) => {
      const params = new URLSearchParams(path);
      params.set('tab', 'settings');
      params.set('settingsSection', section);
      params.delete('agentId');
      navigate(`/?${params.toString()}`);
    },
    [path, navigate],
  );

  const eventHandlers = useMemo(
    () => ({
      'agent:input': async () => {
        ensureConversationInUrl(activeConversationId);
      },
      'client:invalidate': async (chunk: any) => {
        if (Array.isArray(chunk.data?.tags)) {
          queryClient.invalidateQueries({
            predicate: (query: any) => {
              const queryTags = (query.meta as any)?.tags as string[] | undefined;
              return queryTags?.some((tag) => chunk.data.tags.includes(tag)) ?? false;
            },
          });
        }
      },
      'stream:done': async () => {
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
        await markConversationRead(activeConversationId);
      },
    }),
    [queryClient, ensureConversationInUrl, activeConversationId, markConversationRead],
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
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [activeConversationId, markConversationRead]);

  const handleNavigate = useCallback(
    (path: string) => {
      const params = new URLSearchParams(path.split('?')[1] || '');
      const nextConversationId = params.get('conversationId');

      if (nextConversationId && nextConversationId !== activeConversationId) {
        if (nextConversationId.startsWith('dm_')) {
          setRightPanel('agent');
        } else if (nextConversationId.startsWith('channel_')) {
          // Only switch to spec if a panel is already open
          if (rightPanel) {
            setRightPanel('spec');
          }
        }
      }
      navigate(path);
    },
    [activeConversationId, navigate, rightPanel, setRightPanel],
  );

  useEffect(() => {
    if (tab === 'settings' || tab === 'agents') {
      setRightPanel(null);
    }
  }, [tab, setRightPanel]);

  if (configLoading) return <LoadingScreen />;
  if (config && !config.configured) {
    return (
      <Onboarding defaultModelId={config.defaultModelId} defaultModels={config.defaultModels} />
    );
  }

  return (
    <ChatProvider conversationId={activeConversationId} eventHandlers={eventHandlers}>
      <AppLayout
        conversationId={activeConversationId}
        currentTab={tab === 'agents' ? 'settings' : tab}
        onNavigate={handleNavigate}
        rightWidthClassName="w-[640px] 2xl:w-[840px]"
        settingsSection={tab === 'settings' || tab === 'agents' ? settingsSection : undefined}
        onSettingsSectionChange={setSettingsSection}
        rightSidebar={
          rightPanel === 'spec' ? (
            <ChannelSpecSidebar
              conversationId={activeConversationId}
              onClose={() => setRightPanel(null)}
            />
          ) : rightPanel === 'agent' && activeAgent ? (
            <AgentProfileSidebar
              agent={activeAgent}
              conversationId={activeConversationId}
              onClose={() => setRightPanel(null)}
            />
          ) : null
        }
        rightActions={
          tab === 'chat' ? (
            <Button
              type="button"
              variant={rightPanel ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                const nextPanel = activeConversationId.startsWith('channel_') ? 'spec' : 'agent';
                setRightPanel(rightPanel === nextPanel ? null : nextPanel);
              }}
              className="h-8 size-8 p-0"
              aria-pressed={Boolean(rightPanel)}
              title={rightPanel ? 'Hide info' : 'Show info'}
            >
              <InfoIcon className="size-4" />
            </Button>
          ) : null
        }
        onHeaderClick={() => {
          const nextPanel = activeConversationId.startsWith('channel_') ? 'spec' : 'agent';
          setRightPanel(rightPanel === nextPanel ? null : nextPanel);
        }}
      >
        {tab === 'chat' && activeConversationId && <ChatPage conversationId={activeConversationId} />}
        {tab === 'chat' && !activeConversationId && <NoConversationsPlaceholder />}
        {tab === 'agents' && (
          <SettingsPage
            defaultSection={'agents' as SettingsSection}
            currentSection={settingsSection}
            onSectionChange={setSettingsSection}
          />
        )}
        {tab === 'automations' && <AutomationsPage />}
        {tab === 'settings' && (
          <SettingsPage currentSection={settingsSection} onSectionChange={setSettingsSection} />
        )}
      </AppLayout>
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
