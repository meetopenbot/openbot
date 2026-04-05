import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTheme } from '../ThemeProvider';
import { useConfig } from '../../hooks/use-config';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, USER_VARIABLE_SECRET_UNCHANGED, type MarketplaceItem } from '../../lib/api';
import { useSession } from '../../hooks/use-session';
import { cn } from '../../lib/utils';
import { AgentsPage } from './AgentsPage';
import { ExtensionItem } from '../ExtensionItem';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';

type Theme = 'light' | 'dark' | 'system';
const VARIABLE_MASK_DISPLAY = '••••••••••••••••';

const THEME_OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'monitor' },
];

export function SettingsPage({ defaultSection }: { defaultSection?: SettingsSection }) {
  return <SettingsPageWithSections defaultSection={defaultSection} />;
}

type SettingsSection = 'general' | 'variables' | 'agents' | 'plugins' | 'system';

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'variables', label: 'Variables' },
  { id: 'agents', label: 'Agents' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'system', label: 'System' },
];

function resolveSettingsSection(raw: string | null): SettingsSection {
  if (
    raw === 'general' ||
    raw === 'variables' ||
    raw === 'agents' ||
    raw === 'plugins' ||
    raw === 'system'
  ) {
    return raw;
  }
  return 'general';
}

type VariableRowState = {
  id: string;
  key: string;
  secret: boolean;
  draft: string;
  /** Loaded secret with a value; user has not edited yet — submit unchanged sentinel if still empty */
  committedUnchanged: boolean;
};

function variableRowsFromServer(
  list: Array<{ key: string; secret: boolean; hasValue: boolean; value?: string }>,
): VariableRowState[] {
  return list.map((v) => ({
    id: crypto.randomUUID(),
    key: v.key,
    secret: v.secret,
    draft: v.secret ? '' : (v.value ?? ''),
    committedUnchanged: v.secret && v.hasValue,
  }));
}

function SettingsPageWithSections({ defaultSection }: { defaultSection?: SettingsSection }) {
  const { path, navigate } = useSession();
  const { data: config } = useConfig();
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();

  const [reloadAck, setReloadAck] = useState(false);

  const [installingPluginId, setInstallingPluginId] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const [varRows, setVarRows] = useState<VariableRowState[]>([]);
  const [varValueFocusId, setVarValueFocusId] = useState<string | null>(null);
  const [varsSaved, setVarsSaved] = useState(false);
  const [variablesSaveError, setVariablesSaveError] = useState<string | null>(null);

  // User Profile state
  const [profileDraft, setProfileDraft] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);

  const settingsSection = useMemo(() => {
    const params = new URLSearchParams(path);
    const fromQuery = resolveSettingsSection(params.get('settingsSection'));
    if (params.has('settingsSection')) return fromQuery;
    return defaultSection ?? 'general';
  }, [path, defaultSection]);

  const setSettingsSection = (section: SettingsSection) => {
    const params = new URLSearchParams(path);
    params.set('tab', 'settings');
    params.set('settingsSection', section);
    if (section !== 'agents') {
      params.delete('agentId');
    }
    navigate(`/?${params.toString()}`);
  };

  const { data: profileData } = useQuery({
    queryKey: ['userProfile'],
    queryFn: api.getUserProfile,
    enabled: settingsSection === 'general',
  });

  useEffect(() => {
    if (profileData?.profile != null) {
      setProfileDraft(profileData.profile);
    }
  }, [profileData]);

  const saveProfileMutation = useMutation({
    mutationFn: () => api.updateUserProfile(profileDraft),
    onSuccess: async () => {
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
      await queryClient.invalidateQueries({ queryKey: ['userProfile'] });
    },
  });

  const handleProfileSave = useCallback(() => {
    saveProfileMutation.mutate();
  }, [saveProfileMutation]);

  const { data: varsData } = useQuery({
    queryKey: ['variables'],
    queryFn: api.getVariables,
    enabled: settingsSection === 'variables',
  });

  useEffect(() => {
    if (!varsData?.variables) return;
    setVarRows(variableRowsFromServer(varsData.variables));
    setVariablesSaveError(null);
  }, [varsData]);

  const saveVariablesMutation = useMutation({
    mutationFn: () =>
      api.updateVariables(
        varRows.map((r) => ({
          key: r.key.trim(),
          secret: r.secret,
          value:
            r.secret && r.committedUnchanged && r.draft === ''
              ? USER_VARIABLE_SECRET_UNCHANGED
              : r.draft,
        })),
      ),
    onSuccess: async () => {
      setVariablesSaveError(null);
      setVarsSaved(true);
      setTimeout(() => setVarsSaved(false), 2000);
      await queryClient.invalidateQueries({ queryKey: ['variables'] });
    },
    onError: (err: Error) => {
      setVariablesSaveError(err.message || 'Failed to save variables');
    },
  });

  const { data: plugins = [], isLoading: loadingPlugins } = useQuery({
    queryKey: ['plugins'],
    queryFn: api.getInstalledPlugins,
  });

  const { data: marketplacePlugins = [], isLoading: loadingMarketplacePlugins } = useQuery({
    queryKey: ['marketplace', 'plugins'],
    queryFn: api.getMarketplacePlugins,
  });

  const installedPluginKeys = useMemo(() => {
    return new Set(
      plugins.map((plugin) => [plugin.id, plugin.name].map((v) => (v || '').toLowerCase())).flat(),
    );
  }, [plugins]);

  const isPluginInstalled = (item: MarketplaceItem) =>
    installedPluginKeys.has(item.id.toLowerCase()) ||
    installedPluginKeys.has(item.name.toLowerCase());

  const handleInstallPlugin = async (item: MarketplaceItem) => {
    setInstallError(null);
    setInstallingPluginId(item.id);
    try {
      await api.installMarketplacePlugin(item.id);
      await queryClient.invalidateQueries({ queryKey: ['plugins'] });
      await queryClient.invalidateQueries({ queryKey: ['marketplace', 'plugins'] });
    } catch (err) {
      console.error(err);
      setInstallError(`Failed to install plugin "${item.name}"`);
    } finally {
      setInstallingPluginId(null);
    }
  };

  const recommendedPlugins = useMemo(() => {
    return marketplacePlugins.filter(
      (item) => item.tags?.includes('recommended') && !isPluginInstalled(item),
    );
  }, [marketplacePlugins, installedPluginKeys]);

  const otherMarketplacePlugins = useMemo(() => {
    return marketplacePlugins.filter(
      (item) => !item.tags?.includes('recommended') && !isPluginInstalled(item),
    );
  }, [marketplacePlugins, installedPluginKeys]);

  if (!config) return null;

  return (
    <div className="h-full overflow-hidden">
      <div className="flex h-full">
        <aside className="hidden sm:flex w-52 shrink-0 border-r border-border/50 bg-muted/10 p-3">
          <div className="w-full flex flex-col gap-1">
            <div className="px-2 py-1.5">
              <h2 className="text-sm font-semibold tracking-tight">Settings</h2>
              <p className="text-[11px] text-muted-foreground/70">Manage OpenBot</p>
            </div>
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setSettingsSection(section.id)}
                className={cn(
                  'w-full rounded-md px-2.5 py-2 text-left text-[13px] transition-colors',
                  settingsSection === section.id
                    ? 'bg-muted/70 text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                {section.label}
              </button>
            ))}
          </div>
        </aside>
        <div className="flex-1 min-w-0 h-full">
          {settingsSection === 'agents' && <AgentsPage />}
          {settingsSection !== 'agents' && (
            <div className="h-full overflow-auto">
              <div className="mx-auto flex max-w-xl flex-col gap-10 px-6 py-10 animate-in fade-in">
                {settingsSection === 'general' && (
                  <>
                    <div className="flex flex-col gap-1">
                      <h2 className="text-lg font-semibold tracking-tight">General</h2>
                      <p className="text-[13px] text-muted-foreground/70">
                        Appearance and theme preferences.
                      </p>
                    </div>
                    <section className="flex flex-col gap-4">
                      <div className="flex flex-col gap-0.5">
                        <h3 className="text-[13px] font-medium">Appearance</h3>
                        <p className="text-xs text-muted-foreground/60">
                          Choose your preferred color theme
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {THEME_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setTheme(opt.value)}
                            className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-medium transition-all duration-150 ${
                              theme === opt.value
                                ? 'border-foreground/15 bg-foreground/4 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
                                : 'border-border/50 text-muted-foreground hover:border-border hover:text-foreground'
                            }`}
                          >
                            <ThemeIcon type={opt.icon} />
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </section>
                    <section className="flex flex-col gap-4">
                      <div className="flex flex-col gap-0.5">
                        <h3 className="text-[13px] font-medium">User Profile</h3>
                        <p className="text-xs text-muted-foreground/60">
                          Tell OpenBot about yourself. All agents read this to personalize their
                          responses. Stored locally in{' '}
                          <code className="rounded bg-muted/50 px-1 py-0.5 text-[11px]">
                            ~/.openbot/USER.md
                          </code>
                        </p>
                      </div>
                      <Textarea
                        value={profileDraft}
                        onChange={(e) => setProfileDraft(e.target.value)}
                        placeholder="Tell agents about yourself — your name, preferences, projects, how you like to work..."
                        rows={8}
                        className="font-mono text-xs resize-y"
                      />
                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          size="sm"
                          disabled={
                            saveProfileMutation.isPending ||
                            profileDraft === (profileData?.profile ?? '')
                          }
                          onClick={handleProfileSave}
                        >
                          {profileSaved
                            ? 'Saved'
                            : saveProfileMutation.isPending
                              ? 'Saving...'
                              : 'Save profile'}
                        </Button>
                        {profileDraft !== (profileData?.profile ?? '') && (
                          <span className="text-[11px] text-muted-foreground/50">
                            Unsaved changes
                          </span>
                        )}
                      </div>
                    </section>
                    <p className="text-xs text-muted-foreground/60">
                      Provider API keys: use{' '}
                      <button
                        type="button"
                        onClick={() => setSettingsSection('variables')}
                        className="font-medium text-foreground/80 underline decoration-border/60 underline-offset-2 hover:text-foreground"
                      >
                        Variables
                      </button>{' '}
                      to set <code className="text-[11px]">OPENAI_API_KEY</code> and{' '}
                      <code className="text-[11px]">ANTHROPIC_API_KEY</code>.
                    </p>
                  </>
                )}
                {settingsSection === 'variables' && (
                  <section className="flex flex-col gap-4 pb-20">
                    <div className="flex flex-col gap-1">
                      <h2 className="text-lg font-semibold tracking-tight">Variables</h2>
                      <p className="text-[13px] text-muted-foreground/70">
                        Environment variables stored in{' '}
                        <code className="rounded bg-muted/50 px-1 py-0.5 text-[11px]">variables.json</code>{' '}
                        (not in <code className="rounded bg-muted/50 px-1 py-0.5 text-[11px]">config.json</code>
                        ). Applied to the server process on save and reload.
                      </p>
                    </div>

                    {variablesSaveError && (
                      <p className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-600 dark:text-red-300">
                        {variablesSaveError}
                      </p>
                    )}

                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setVarRows((prev) => [
                            {
                              id: crypto.randomUUID(),
                              key: '',
                              secret: true,
                              draft: '',
                              committedUnchanged: false,
                            },
                            ...prev,
                          ])
                        }
                      >
                        Add variable
                      </Button>
                    </div>

                    <div className="flex flex-col gap-1">
                      {varRows.length > 0 && (
                        <div className="hidden sm:flex items-center gap-2 px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">
                          <span className="w-44">Name</span>
                          <span className="flex-1">Value</span>
                          <span className="w-16 text-center">Secret</span>
                          <span className="w-10"></span>
                        </div>
                      )}

                      <div className="flex flex-col gap-2">
                        {varRows.length === 0 ? (
                          <p className="py-8 text-center text-xs text-muted-foreground bg-muted/5 rounded-xl border border-dashed border-border/50">
                            No variables yet.
                          </p>
                        ) : (
                          varRows.map((row) => {
                            const showMasked =
                              row.secret && row.committedUnchanged && varValueFocusId !== row.id;
                            const displayValue = showMasked ? VARIABLE_MASK_DISPLAY : row.draft;
                            return (
                              <div
                                key={row.id}
                                className="flex flex-col gap-2 rounded-lg border border-border/50 bg-muted/5 p-2 sm:flex-row sm:items-center sm:gap-2"
                              >
                                <input
                                  value={row.key}
                                  onChange={(e) =>
                                    setVarRows((prev) =>
                                      prev.map((r) =>
                                        r.id === row.id ? { ...r, key: e.target.value } : r,
                                      ),
                                    )
                                  }
                                  placeholder="NAME"
                                  autoComplete="off"
                                  spellCheck={false}
                                  className="w-full shrink-0 rounded-md border border-border/60 bg-background px-2.5 py-1.5 font-mono text-xs transition-colors focus:border-primary/30 focus:outline-none sm:w-44"
                                />
                                <input
                                  type={row.secret ? 'password' : 'text'}
                                  value={displayValue}
                                  onChange={(e) =>
                                    setVarRows((prev) =>
                                      prev.map((r) =>
                                        r.id === row.id
                                          ? {
                                              ...r,
                                              draft: e.target.value,
                                              committedUnchanged: false,
                                            }
                                          : r,
                                      ),
                                    )
                                  }
                                  onFocus={() => setVarValueFocusId(row.id)}
                                  onBlur={() =>
                                    setVarValueFocusId((id) => (id === row.id ? null : id))
                                  }
                                  placeholder={row.secret ? '••••••••' : 'value'}
                                  autoComplete="off"
                                  spellCheck={false}
                                  className="flex-1 rounded-md border border-border/60 bg-background px-2.5 py-1.5 font-mono text-xs transition-colors focus:border-primary/30 focus:outline-none"
                                />
                                <div className="flex items-center gap-4 shrink-0 px-1 sm:w-28 sm:justify-end sm:gap-4">
                                  <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
                                    <input
                                      type="checkbox"
                                      checked={row.secret}
                                      onChange={(e) =>
                                        setVarRows((prev) =>
                                          prev.map((r) =>
                                            r.id === row.id
                                              ? {
                                                  ...r,
                                                  secret: e.target.checked,
                                                  committedUnchanged: e.target.checked
                                                    ? r.committedUnchanged
                                                    : false,
                                                }
                                              : r,
                                          ),
                                        )
                                      }
                                      className="size-3.5 rounded border-border/60"
                                    />
                                    <span className="sm:hidden">Secret</span>
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setVarRows((prev) => prev.filter((r) => r.id !== row.id))
                                    }
                                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                                    title="Remove variable"
                                  >
                                    <TrashIcon />
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {varRows.length > 0 && (
                      <div className="flex justify-start pt-2">
                        <Button
                          type="button"
                          disabled={saveVariablesMutation.isPending}
                          onClick={() => saveVariablesMutation.mutate()}
                        >
                          {varsSaved
                            ? 'Saved'
                            : saveVariablesMutation.isPending
                              ? 'Saving...'
                              : 'Save variables'}
                        </Button>
                      </div>
                    )}
                  </section>
                )}
                {settingsSection === 'plugins' && (
                  <section className="flex flex-col gap-6 pb-20">
                    <div className="flex flex-col gap-1">
                      <h2 className="text-lg font-semibold tracking-tight">Plugins</h2>
                      <p className="text-[13px] text-muted-foreground/70">
                        Install and manage system extensions.
                      </p>
                    </div>
                    {installError && (
                      <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
                        {installError}
                      </p>
                    )}
                    <div className="flex flex-col gap-8">
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-3">
                          Installed
                        </h4>
                        {loadingPlugins ? (
                          <div className="flex flex-col gap-2">
                            {[1, 2].map((i) => (
                              <div
                                key={i}
                                className="h-16 rounded-xl bg-muted/10 border border-border/20 animate-pulse"
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1 -mx-3">
                            {plugins.map((plugin) => (
                              <ExtensionItem
                                key={plugin.id}
                                id={plugin.id}
                                name={plugin.name}
                                description={plugin.description}
                                type="plugin"
                                isInstalled
                                image={plugin.image}
                              />
                            ))}
                            {plugins.length === 0 && (
                              <div className="py-6 text-center text-xs text-muted-foreground bg-muted/5 rounded-xl border border-dashed border-border/50 mx-3">
                                No plugins installed.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      {recommendedPlugins.length > 0 && (
                        <div>
                          <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-3">
                            Recommended
                          </h4>
                          <div className="flex flex-col gap-1 -mx-3">
                            {recommendedPlugins.map((item) => (
                              <ExtensionItem
                                key={item.id}
                                id={item.id}
                                name={item.name}
                                description={item.description}
                                type="plugin"
                                image={item.image}
                                onInstall={() => handleInstallPlugin(item)}
                                isInstalling={installingPluginId === item.id}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                      {otherMarketplacePlugins.length > 0 && (
                        <div>
                          <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-3">
                            Marketplace
                          </h4>
                          {loadingMarketplacePlugins ? (
                            <div className="flex flex-col gap-2">
                              {[1, 2].map((i) => (
                                <div
                                  key={i}
                                  className="h-16 rounded-xl bg-muted/10 border border-border/20 animate-pulse"
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1 -mx-3">
                              {otherMarketplacePlugins.map((item) => (
                                <ExtensionItem
                                  key={item.id}
                                  id={item.id}
                                  name={item.name}
                                  description={item.description}
                                  type="plugin"
                                  image={item.image}
                                  onInstall={() => handleInstallPlugin(item)}
                                  isInstalling={installingPluginId === item.id}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </section>
                )}
                {settingsSection === 'system' && (
                  <section className="flex flex-col gap-4 pb-20">
                    <div className="flex flex-col gap-1">
                      <h2 className="text-lg font-semibold tracking-tight">System</h2>
                      <p className="text-[13px] text-muted-foreground/70">
                        Advanced maintenance operations.
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-4">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await api.reload();
                            setReloadAck(true);
                            setTimeout(() => setReloadAck(false), 2000);
                          } catch (err) {
                            console.error('Reload failed', err);
                          }
                        }}
                        className="rounded-xl border border-border/60 px-4 py-2.5 text-[13px] font-medium text-foreground transition-all duration-150 hover:border-border hover:bg-foreground/5"
                      >
                        {reloadAck ? 'Reloaded' : 'Reload Runtime'}
                      </button>
                      <p className="text-[11px] text-muted-foreground/50">
                        Reloads agents and plugins from disk. Use this if you've manually modified
                        configuration files.
                      </p>
                    </div>
                  </section>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ThemeIcon({ type }: { type: string }) {
  const props = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (type === 'sun')
    return (
      <svg {...props}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </svg>
    );

  if (type === 'moon')
    return (
      <svg {...props}>
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    );

  return (
    <svg {...props}>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}
