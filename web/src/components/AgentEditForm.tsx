import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AgentConfig } from '../lib/api';
import { AgentAvatar } from './AgentAvatar';
import { ModelSelector } from './ModelSelector';
import { useModels } from '../hooks/use-models';
import { Button } from './ui/button';

const ChevronLeft = ({ className }: { className?: string }) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="m15 18-6-6 6-6" />
  </svg>
);

type PluginRow = {
  name: string;
  configText: string;
};

function configToPluginRows(config: AgentConfig): PluginRow[] {
  const rows = (config.plugins || []).map((plugin) => {
    if (typeof plugin === 'string') {
      return { name: plugin, configText: '' };
    }
    return {
      name: plugin.name,
      configText:
        typeof plugin.config === 'undefined' ? '' : JSON.stringify(plugin.config, null, 2),
    };
  });

  return rows;
}

export function AgentEditForm({
  agentId,
  agentName,
  folder,
  isDefault,
  hasAgentMd,
  onUpdate,
  onBack,
  hideHeader = false,
  mode = 'edit',
  onCreate,
}: {
  agentId: string;
  agentName: string;
  folder?: string;
  isDefault?: boolean;
  hasAgentMd?: boolean;
  onUpdate?: () => void;
  onBack?: () => void;
  hideHeader?: boolean;
  mode?: 'edit' | 'create';
  onCreate?: (agentId: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data: models = [] } = useModels();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCreateMode = mode === 'create';

  // Agent Config (YAML fields)
  const [name, setName] = useState(agentName);
  const [id, setId] = useState(agentId);
  const [idDirty, setIdDirty] = useState(false);
  const [description, setDescription] = useState('');
  const [model, setModel] = useState('');
  const [runtime, setRuntime] = useState('llm');
  const [image, setImage] = useState('');
  const [subscribeText, setSubscribeText] = useState('');
  const [pluginRows, setPluginRows] = useState<PluginRow[]>([]);

  // AGENT.md content
  const [mdContent, setMdContent] = useState('');
  const isCodeOnlyAgent = !isDefault && hasAgentMd === false;

  useEffect(() => {
    if (isCreateMode || idDirty) return;
    const next = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    setId(next || 'agent');
  }, [name, idDirty, isCreateMode]);

  useEffect(() => {
    if (isCreateMode) {
      setLoading(false);
      setError(null);
      return;
    }

    if (isCodeOnlyAgent) {
      setLoading(false);
      setName(agentName);
      setDescription('Code-only agent');
      return;
    }

    setLoading(true);
    setError(null);

    const promises = [];
    const effectiveName = isDefault ? 'default' : agentId;

    if (isDefault) {
      promises.push(
        api.getConfig().then((config) => {
          setModel(config.model || '');
          setName(config.name || agentName);
          setDescription(config.description || '');
          setImage(config.image || '');
        }),
      );
    } else {
      promises.push(
        api.getAgentConfig(effectiveName).then((config) => {
          setName(config.name || agentName);
          setDescription(config.description || '');
          setModel(config.model || '');
          setRuntime(
            typeof config.runtime === 'string'
              ? config.runtime
              : typeof config.runtime === 'object' && config.runtime !== null
              ? (config.runtime as any).name
              : 'llm',
          );
          setImage(config.image || '');
          setSubscribeText((config.subscribe || []).join(', '));
          setPluginRows(configToPluginRows(config));
        }),
      );
    }

    promises.push(
      api
        .getAgentMd(effectiveName)
        .then((md) => setMdContent(md))
        .catch(() => setMdContent('')), // Ignore errors for MD
    );

    Promise.all(promises)
      .catch((err) => {
        console.error(err);
        setError('Failed to load agent details');
      })
      .finally(() => setLoading(false));
  }, [agentId, agentName, isDefault, isCodeOnlyAgent, isCreateMode]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    const effectiveName = isDefault ? 'default' : agentId;
    try {
      if (isCreateMode) {
        const normalizedId = id
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-_]+/g, '-')
          .replace(/^-+|-+$/g, '');
        if (!normalizedId) {
          setError('Agent ID is required');
          setSaving(false);
          return;
        }

        if (!name.trim() || !description.trim()) {
          setError('Name and description are required');
          setSaving(false);
          return;
        }

        const plugins: Array<string | { name: string; config?: unknown }> = [];
        const seenPluginNames = new Set<string>();
        for (const row of pluginRows) {
          const pluginName = row.name.trim();
          if (!pluginName) continue;
          if (seenPluginNames.has(pluginName)) {
            setError(`Plugin "${pluginName}" is selected more than once`);
            setSaving(false);
            return;
          }
          seenPluginNames.add(pluginName);
          if (!row.configText.trim()) {
            plugins.push(pluginName);
            continue;
          }
          try {
            plugins.push({ name: pluginName, config: JSON.parse(row.configText) });
          } catch {
            setError(`Plugin "${pluginName}" has invalid JSON config`);
            setSaving(false);
            return;
          }
        }

        const subscribe = subscribeText
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);

        await api.createAgent({
          id: normalizedId,
          name: name.trim(),
          description: description.trim(),
          model: model.trim() || undefined,
          runtime: runtime.trim() || 'llm',
          image: image.trim() || undefined,
          plugins,
          subscribe,
          md: mdContent,
        });
        await queryClient.invalidateQueries({ queryKey: ['agents'] });
        onCreate?.(normalizedId);
        onUpdate?.();
      } else if (isDefault) {
        await api.updateConfig({
          model: model.trim() || undefined,
          name: name.trim() || undefined,
          description: description.trim() || undefined,
          image: image.trim() || undefined,
        });
      } else {
        const plugins: Array<string | { name: string; config?: unknown }> = [];
        const seenPluginNames = new Set<string>();

        for (const row of pluginRows) {
          const pluginName = row.name.trim();
          if (!pluginName) continue;
          if (seenPluginNames.has(pluginName)) {
            setError(`Plugin "${pluginName}" is selected more than once`);
            setSaving(false);
            return;
          }
          seenPluginNames.add(pluginName);

          if (!row.configText.trim()) {
            plugins.push(pluginName);
            continue;
          }

          try {
            plugins.push({
              name: pluginName,
              config: JSON.parse(row.configText),
            });
          } catch {
            setError(`Plugin "${pluginName}" has invalid JSON config`);
            setSaving(false);
            return;
          }
        }

        const subscribe = subscribeText
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);

        if (!name.trim() || !description.trim()) {
          setError('Name and description are required');
          setSaving(false);
          return;
        }

        await api.updateAgentConfig(effectiveName, {
          name: name.trim(),
          description: description.trim(),
          model: model.trim() || undefined,
          runtime: runtime.trim() || 'llm',
          image: image.trim() || undefined,
          plugins,
          subscribe,
        });
      }

      await api.updateAgentMd(effectiveName, mdContent);

      await queryClient.invalidateQueries({ queryKey: ['agents'] });
      onUpdate?.();
    } catch (err) {
      console.error(err);
      setError('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const { data: registryPlugins = [] } = useQuery({
    queryKey: ['registry', 'plugins'],
    queryFn: api.getRegistryPlugins,
  });

  const selectedPluginNames = pluginRows.map((row) => row.name).filter(Boolean);
  const nextPluginToAdd = registryPlugins.find(
    (plugin) => !selectedPluginNames.includes(plugin.name),
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground p-12">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-t-transparent border-foreground/20 rounded-full animate-spin" />
          <span className="text-sm">Loading agent details...</span>
        </div>
      </div>
    );
  }

  if (isCodeOnlyAgent) {
    return (
      <div className="flex flex-col h-full bg-background overflow-hidden">
        {!hideHeader && (
          <div className="flex items-center justify-between border-b border-border/50 px-6 py-4 bg-background/50 backdrop-blur-sm sticky top-0 z-10 shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={onBack}
                className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors mr-1"
                title="Back to agents"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <AgentAvatar
                name={agentId}
                label={agentName}
                imageUrl={image.trim() || undefined}
                className="w-8 h-8 rounded-md"
              />
              <h2 className="text-lg font-semibold tracking-tight">{agentName}</h2>
              <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-500 text-[10px] font-bold uppercase tracking-wider">
                Code Only
              </span>
            </div>
          </div>
        )}

        <div className="flex-1 flex items-center justify-center p-12 text-center overflow-auto">
          <div className="max-w-md flex flex-col gap-6 items-center">
            <div className="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center text-purple-500">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-xl font-semibold text-foreground">Code-only Agent</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                This agent has no <code>AGENT.md</code>. To modify its behavior, capabilities, or
                configuration, edit files directly in:
              </p>
              <div className="mt-2 p-3 rounded-xl bg-muted/50 border border-border/50 font-mono text-[11px] text-foreground/80 break-all text-left flex items-center justify-between group">
                <code>{folder || '(folder unavailable)'}</code>
                <button
                  onClick={() => folder && api.openFolder(folder)}
                  disabled={!folder}
                  className="ml-2 p-1.5 rounded-lg hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
                  title="Open folder"
                >
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
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {!hideHeader && (
        <div className="flex items-center justify-between border-b border-border/50 px-6 py-4 bg-background/50 backdrop-blur-sm sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors mr-1"
              title="Back to agents"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <AgentAvatar
              name={isDefault ? 'default' : agentId}
              label={agentName}
              imageUrl={image.trim() || undefined}
              className="w-8 h-8 rounded-md"
            />
            <h2 className="text-lg font-semibold tracking-tight">{agentName}</h2>
            {isDefault && (
              <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 text-[10px] font-bold uppercase tracking-wider">
                Default
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Main Content - Markdown Instructions */}
        <div className="flex flex-col min-w-0 h-full flex-1">
          <div className="flex-1 overflow-auto p-6 flex flex-col gap-6">
            {error && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300 shrink-0">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-3 h-full w-full">
              <div className="flex flex-col gap-1 px-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Instructions (AGENT.md)
                </label>
                <span className="text-[11px] text-muted-foreground/60">
                  Instructions for the agent
                </span>
              </div>
              <textarea
                value={mdContent}
                onChange={(e) => setMdContent(e.target.value)}
                className="flex-1 min-h-[260px] w-full rounded-2xl border border-border/60 bg-background/50 px-6 py-6 font-mono text-sm focus:outline-none focus:border-foreground/30 transition-all leading-relaxed resize-none shadow-sm"
                placeholder="# Agent Instructions&#10;&#10;Explain what this agent does and how it should be used..."
              />
            </div>
            {hideHeader && (
              <div className="flex items-center justify-end gap-3 shrink-0 pt-4 border-t border-border/50">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar - Configuration */}
        <div className="border-l border-border/50 bg-muted/5 flex flex-col h-full min-w-0 w-96">
          <div className="p-4 border-b border-border/50 bg-background/50 flex flex-col gap-1 shrink-0">
            <h3 className="text-sm font-semibold tracking-tight">Configuration</h3>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              Agent Details & Plugins
            </p>
          </div>

          <div className="flex-1 overflow-auto p-5 flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-xl border border-border/60 bg-background/50 px-4 py-2.5 text-sm transition-all focus:border-foreground/30 focus:outline-none"
                placeholder="agent name"
              />
            </div>

            {isCreateMode && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  ID
                </label>
                <input
                  value={id}
                  onChange={(e) => {
                    setIdDirty(true);
                    setId(e.target.value);
                  }}
                  className="rounded-xl border border-border/60 bg-background/50 px-4 py-2.5 text-sm transition-all focus:border-foreground/30 focus:outline-none"
                  placeholder="my-bot"
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Runtime
              </label>
              <select
                value={runtime}
                onChange={(e) => setRuntime(e.target.value)}
                className="rounded-xl border border-border/60 bg-background/50 px-4 py-2.5 text-sm transition-all focus:border-foreground/30 focus:outline-none"
              >
                <option value="llm">Default (LLM + Orchestrator)</option>
                {registryPlugins
                  .filter((p) => p.name !== 'shell' && p.name !== 'file-system' && p.name !== 'approval')
                  .map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Model (optional)
              </label>
              <ModelSelector
                value={model}
                models={models}
                onChange={setModel}
                placeholder="openai/gpt-4o"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="rounded-xl border border-border/60 bg-background/50 px-4 py-2.5 text-sm transition-all focus:border-foreground/30 focus:outline-none resize-y"
                placeholder="short summary"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Image URL (optional)
              </label>
              <input
                value={image}
                onChange={(e) => setImage(e.target.value)}
                className="rounded-xl border border-border/60 bg-background/50 px-4 py-2.5 text-sm transition-all focus:border-foreground/30 focus:outline-none"
                placeholder="https://..."
              />
            </div>

            {!isDefault && (
              <>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Plugins
                    </label>
                    <button
                      onClick={() => {
                        if (!nextPluginToAdd) return;
                        setPluginRows((rows) => [
                          ...rows,
                          { name: nextPluginToAdd.name, configText: '' },
                        ]);
                      }}
                      disabled={!nextPluginToAdd}
                      className="rounded-lg border border-border/60 px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      + Add
                    </button>
                  </div>
                  <div className="flex flex-col gap-3">
                    {pluginRows.map((row, index) => (
                      <div
                        key={index}
                        className="rounded-xl border border-border/60 bg-background/50 p-3 group transition-all hover:bg-muted/10 shadow-sm"
                      >
                        <div className="flex items-center gap-2">
                          <select
                            value={row.name}
                            onChange={(e) => {
                              const next = [...pluginRows];
                              next[index] = { ...next[index], name: e.target.value };
                              setPluginRows(next);
                            }}
                            className="flex-1 rounded-lg border border-border/60 bg-background px-2 py-1.5 text-[13px] focus:outline-none"
                          >
                            {[
                              ...registryPlugins,
                              ...(!registryPlugins.some((p) => p.name === row.name) && row.name
                                ? [{ name: row.name, description: 'Custom plugin (existing)' }]
                                : []),
                            ].map((plugin) => {
                              const alreadySelectedElsewhere = pluginRows.some(
                                (item, itemIndex) =>
                                  itemIndex !== index && item.name === plugin.name,
                              );
                              return (
                                <option
                                  key={plugin.name}
                                  value={plugin.name}
                                  disabled={alreadySelectedElsewhere}
                                >
                                  {plugin.name}
                                </option>
                              );
                            })}
                          </select>
                          <button
                            onClick={() =>
                              setPluginRows((rows) => rows.filter((_, i) => i !== index))
                            }
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors"
                            title="Remove plugin"
                          >
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
                              <path d="M3 6h18"></path>
                              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Subscribed Events
                  </label>
                  <input
                    value={subscribeText}
                    onChange={(e) => setSubscribeText(e.target.value)}
                    className="rounded-xl border border-border/60 bg-background/50 px-4 py-2.5 text-sm transition-all focus:border-foreground/30 focus:outline-none"
                    placeholder="event:chat:message, ..."
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
