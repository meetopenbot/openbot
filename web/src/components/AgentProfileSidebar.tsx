import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type AgentConfig } from '../lib/api';
import { useModels } from '../hooks/use-models';
import { ModelSelector } from './ModelSelector';
import { AgentAvatar } from './AgentAvatar';
import { Button } from './ui/button';
import { XIcon, FileTextIcon, SettingsIcon, DatabaseIcon } from 'lucide-react';
import { Textarea } from './ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

type Tab = 'instructions' | 'configure' | 'state';

type PluginRow = { name: string; configText: string };

function configToPluginRows(config: AgentConfig): PluginRow[] {
  return (config.plugins || []).map((plugin) => {
    if (typeof plugin === 'string') return { name: plugin, configText: '' };
    return {
      name: plugin.name,
      configText:
        typeof plugin.config === 'undefined' ? '' : JSON.stringify(plugin.config, null, 2),
    };
  });
}

interface AgentProfileSidebarProps {
  agent: {
    id: string;
    name: string;
    folder?: string;
    isDefault?: boolean;
    isBuiltIn?: boolean;
    hasAgentMd?: boolean;
    image?: string;
  };
  conversationId: string;
  onClose?: () => void;
}

export function AgentProfileSidebar({ agent, conversationId, onClose }: AgentProfileSidebarProps) {
  const queryClient = useQueryClient();
  const { data: models = [] } = useModels();
  const [tab, setTab] = useState<Tab>('instructions');

  const [mdContent, setMdContent] = useState('');
  const [isMdSaving, setIsMdSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState('');
  const [model, setModel] = useState('');
  const [runtime, setRuntime] = useState('llm');
  const [image, setImage] = useState('');
  const [subscribeText, setSubscribeText] = useState('');
  const [pluginRows, setPluginRows] = useState<PluginRow[]>([]);

  const effectiveName = agent.isDefault ? 'default' : agent.id;
  const isCodeOnly = !agent.isDefault && agent.hasAgentMd === false;

  const { data: registryPlugins = [] } = useQuery({
    queryKey: ['registry', 'plugins'],
    queryFn: api.getRegistryPlugins,
  });

  const { data: stateData, isLoading: isStateLoading } = useQuery({
    queryKey: ['conversationState', conversationId],
    queryFn: () => api.getConversationState(conversationId),
    enabled: !!conversationId && tab === 'state',
  });

  const { isLoading, data: profileData } = useQuery({
    queryKey: ['agentProfile', effectiveName],
    queryFn: async () => {
      const [md, config] = await Promise.all([
        api.getAgentMd(effectiveName).catch(() => ''),
        agent.isDefault
          ? api.getConfig().then((c) => ({
              name: c.name,
              description: c.description,
              model: c.model,
              image: c.image,
            }))
          : api.getAgentConfig(effectiveName),
      ]);

      setMdContent(md);

      if (agent.isDefault) {
        const c = config as { name: string; description: string; model: string; image?: string };
        setName(c.name || agent.name);
        setDescription(c.description || '');
        setModel(c.model || '');
        setImage(c.image || '');
      } else {
        const c = config as AgentConfig;
        setName(c.name || agent.name);
        setDescription(c.description || '');
        setModel(c.model || '');
        setRuntime(
          typeof c.runtime === 'string'
            ? c.runtime
            : typeof c.runtime === 'object' && c.runtime !== null
              ? (c.runtime as any).name
              : 'llm',
        );
        setImage(c.image || '');
        setSubscribeText((c.subscribe || []).join(', '));
        setPluginRows(configToPluginRows(c));
      }

      return { md, config };
    },
    enabled: !isCodeOnly,
  });

  const updateMdMutation = useMutation({
    mutationFn: (md: string) => api.updateAgentMd(effectiveName, md),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agentProfile', effectiveName] });
      setIsMdSaving(false);
    },
    onError: () => {
      setIsMdSaving(false);
    },
  });

  const handleSaveInstructions = () => {
    setIsMdSaving(true);
    updateMdMutation.mutate(mdContent);
  };

  const handleSaveConfig = async () => {
    setError(null);
    setSaving(true);
    try {
      if (agent.isDefault) {
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
            plugins.push({ name: pluginName, config: JSON.parse(row.configText) });
          } catch {
            setError(`Plugin "${pluginName}" has invalid JSON config`);
            setSaving(false);
            return;
          }
        }

        const subscribe = subscribeText
          .split(',')
          .map((s) => s.trim())
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

      await queryClient.invalidateQueries({ queryKey: ['agents'] });
      await queryClient.invalidateQueries({ queryKey: ['agentProfile', effectiveName] });
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const selectedPluginNames = pluginRows.map((r) => r.name).filter(Boolean);
  const nextPluginToAdd = registryPlugins.find((p) => !selectedPluginNames.includes(p.name));

  if (isLoading) {
    return (
      <div className="flex h-full flex-col bg-background p-4 animate-pulse">
        <div className="h-6 w-32 bg-muted rounded mb-4" />
        <div className="flex-1 bg-muted/30 rounded" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background border-l border-border/50">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center bg-background/95 px-4 h-14 backdrop-blur shrink-0 border-b border-border/50">
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-2.5 min-w-0">
            <AgentAvatar
              name={agent.isDefault ? 'default' : agent.id}
              label={agent.name}
              imageUrl={agent.image}
              className="size-7 shrink-0 rounded-md"
            />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground truncate">{agent.name}</h2>
              {agent.isDefault && (
                <p className="text-[10px] text-blue-500 font-medium uppercase tracking-wider">
                  Default Agent
                </p>
              )}
            </div>
          </div>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="size-8 text-muted-foreground hover:text-foreground shrink-0"
            >
              <XIcon className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value: string) => setTab(value as Tab)}
        className="flex-1 h-full overflow-hidden flex flex-col min-h-0 gap-0"
      >
        {/* Tabs */}
        <div className="border-b border-border/50 px-4 shrink-0">
          <TabsList variant="line">
            <TabsTrigger value="instructions">
              <FileTextIcon className="size-3.5" />
              Instructions
            </TabsTrigger>
            <TabsTrigger value="configure">
              <SettingsIcon className="size-3.5" />
              Configure
            </TabsTrigger>
            <TabsTrigger value="state">
              <DatabaseIcon className="size-3.5" />
              State
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab Content */}
        <TabsContent value="instructions" className="m-0">
          <InstructionsTab
            isCodeOnly={isCodeOnly}
            folder={agent.folder}
            mdContent={mdContent}
            setMdContent={setMdContent}
            isSaving={isMdSaving}
            onSave={handleSaveInstructions}
            hasChanges={mdContent !== profileData?.md}
          />
        </TabsContent>
        <TabsContent value="configure" className="m-0">
          <ConfigureTab
            isDefault={agent.isDefault}
            isCodeOnly={isCodeOnly}
            name={name}
            setName={setName}
            description={description}
            setDescription={setDescription}
            model={model}
            setModel={setModel}
            models={models}
            runtime={runtime}
            setRuntime={setRuntime}
            image={image}
            setImage={setImage}
            pluginRows={pluginRows}
            setPluginRows={setPluginRows}
            subscribeText={subscribeText}
            setSubscribeText={setSubscribeText}
            registryPlugins={registryPlugins}
            nextPluginToAdd={nextPluginToAdd}
            error={error}
            saving={saving}
            onSave={handleSaveConfig}
          />
        </TabsContent>
        <TabsContent value="state" className="m-0">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar relative">
              {isStateLoading ? (
                <div className="animate-pulse flex flex-col gap-2">
                  <div className="h-4 bg-muted rounded w-1/2" />
                  <div className="h-20 bg-muted rounded w-full" />
                </div>
              ) : stateData ? (
                <Textarea
                  readOnly
                  value={JSON.stringify(stateData, null, 2)}
                  className="h-full w-full resize-none bg-transparent text-[11px] font-mono leading-relaxed focus-visible:ring-0 border-0"
                />
              ) : (
                <p className="p-4 text-sm text-muted-foreground">Failed to load state.</p>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InstructionsTab({
  isCodeOnly,
  folder,
  mdContent,
  setMdContent,
  isSaving,
  onSave,
  hasChanges,
}: {
  isCodeOnly: boolean;
  folder?: string;
  mdContent: string;
  setMdContent: (v: string) => void;
  isSaving: boolean;
  onSave: () => void;
  hasChanges: boolean;
}) {
  if (isCodeOnly) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="flex flex-col gap-3 items-center max-w-xs">
          <div className="size-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-foreground">Code-only Agent</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            This agent has no{' '}
            <code className="text-[11px] px-1 py-0.5 rounded bg-muted">AGENT.md</code>. Edit files
            directly in the source folder.
          </p>
          {folder && (
            <button
              onClick={() => api.openFolder(folder)}
              className="mt-1 text-xs text-foreground/70 hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Open folder
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar relative">
        <Textarea
          value={mdContent}
          onChange={(e) => setMdContent(e.target.value)}
          className="h-full w-full resize-none bg-transparent text-[13px] leading-relaxed focus-visible:ring-0"
          placeholder="No instructions defined for this agent."
        />
      </div>
      <div className="p-4 bg-background/50">
        <Button
          onClick={onSave}
          disabled={isSaving || !hasChanges}
          className="w-full"
          variant="secondary"
        >
          {isSaving ? 'Saving...' : 'Save Instructions'}
        </Button>
      </div>
    </div>
  );
}

function ConfigureTab({
  isDefault,
  isCodeOnly,
  name,
  setName,
  description,
  setDescription,
  model,
  setModel,
  models,
  runtime,
  setRuntime,
  image,
  setImage,
  pluginRows,
  setPluginRows,
  subscribeText,
  setSubscribeText,
  registryPlugins,
  nextPluginToAdd,
  error,
  saving,
  onSave,
}: {
  isDefault?: boolean;
  isCodeOnly: boolean;
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  models: { id: string; label: string }[];
  runtime: string;
  setRuntime: (v: string) => void;
  image: string;
  setImage: (v: string) => void;
  pluginRows: PluginRow[];
  setPluginRows: (v: PluginRow[] | ((prev: PluginRow[]) => PluginRow[])) => void;
  subscribeText: string;
  setSubscribeText: (v: string) => void;
  registryPlugins: { name: string; description: string; isBuiltIn?: boolean }[];
  nextPluginToAdd?: { name: string; description: string };
  error: string | null;
  saving: boolean;
  onSave: () => void;
}) {
  if (isCodeOnly) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <p className="text-xs text-muted-foreground">
          Code-only agents are configured through their source files.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div className="p-4 flex flex-col gap-5">
          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
              {error}
            </p>
          )}

          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm transition-all focus:border-foreground/30 focus:outline-none"
              placeholder="Agent name"
            />
          </Field>

          <Field label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-background/50 px-3 py-2 text-sm transition-all focus-visible:border-foreground/30 focus-visible:ring-0 resize-y"
              placeholder="Short summary"
            />
          </Field>

          <Field label="Model (optional)">
            <ModelSelector
              value={model}
              models={models}
              onChange={setModel}
              placeholder="openai/gpt-4o"
            />
          </Field>

          {!isDefault && (
            <>
              <Field label="Runtime">
                <select
                  value={runtime}
                  onChange={(e) => setRuntime(e.target.value)}
                  className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm transition-all focus:border-foreground/30 focus:outline-none"
                >
                  <option value="llm">Default (LLM + Orchestrator)</option>
                  {registryPlugins
                    .filter(
                      (p) =>
                        p.name !== 'shell' && p.name !== 'file-system' && p.name !== 'approval',
                    )
                    .map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </Field>

              <Field label="Image URL (optional)">
                <input
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm transition-all focus:border-foreground/30 focus:outline-none"
                  placeholder="https://..."
                />
              </Field>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
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
                    className="rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                  >
                    + Add
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {pluginRows.map((row, index) => (
                    <div
                      key={index}
                      className="rounded-lg border border-border/60 bg-background/50 p-2.5 transition-all hover:bg-muted/10"
                    >
                      <div className="flex items-center gap-2">
                        <select
                          value={row.name}
                          onChange={(e) => {
                            const next = [...pluginRows];
                            next[index] = { ...next[index], name: e.target.value };
                            setPluginRows(next);
                          }}
                          className="flex-1 rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs focus:outline-none"
                        >
                          {[
                            ...registryPlugins,
                            ...(!registryPlugins.some((p) => p.name === row.name) && row.name
                              ? [{ name: row.name, description: 'Custom plugin' }]
                              : []),
                          ].map((plugin) => {
                            const taken = pluginRows.some(
                              (item, i) => i !== index && item.name === plugin.name,
                            );
                            return (
                              <option key={plugin.name} value={plugin.name} disabled={taken}>
                                {plugin.name}
                              </option>
                            );
                          })}
                        </select>
                        <button
                          onClick={() =>
                            setPluginRows((rows) => rows.filter((_, i) => i !== index))
                          }
                          className="rounded-md p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors"
                          title="Remove"
                        >
                          <svg
                            width="12"
                            height="12"
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
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <Field label="Subscribed Events">
                <input
                  value={subscribeText}
                  onChange={(e) => setSubscribeText(e.target.value)}
                  className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm transition-all focus:border-foreground/30 focus:outline-none"
                  placeholder="event:chat:message, ..."
                />
              </Field>
            </>
          )}
        </div>
      </div>

      <div className="border-t border-border/50 p-4 bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
        {error && (
          <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
            {error}
          </p>
        )}
        <Button onClick={onSave} disabled={saving} className="w-full" variant="secondary">
          {saving ? 'Saving...' : 'Save Configuration'}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}
