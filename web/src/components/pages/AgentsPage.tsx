import { useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../hooks/use-session";
import { api, type AgentConfig, type MarketplaceItem } from "../../lib/api";
import { AgentAvatar } from "../AgentAvatar";
import { ModelSelector } from "../ModelSelector";
import { useModels } from "../../hooks/use-models";

const ChevronLeft = ({ className }: { className?: string }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m15 18-6-6 6-6"/></svg>
);

const ChevronRight = ({ className }: { className?: string }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m9 18 6-6-6-6"/></svg>
);

const Plus = ({ className }: { className?: string }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M5 12h14"/><path d="M12 5v14"/></svg>
);

type PluginRow = {
  name: string;
  configText: string;
};

const OFFICIAL_PLUGINS: Array<{ name: string; description: string }> = [
  { name: "shell", description: "Execute shell commands" },
  { name: "file-system", description: "Read and write files" },
  { name: "approval", description: "Require approval for sensitive actions" },
  { name: "browser-tools", description: "Web automation and browsing tools" },
  { name: "search", description: "Search and retrieval tools" },
];

function configToPluginRows(config: AgentConfig): PluginRow[] {
  const rows = (config.plugins || []).map((plugin) => {
    if (typeof plugin === "string") {
      return { name: plugin, configText: "" };
    }
    return {
      name: plugin.name,
      configText: typeof plugin.config === "undefined" ? "" : JSON.stringify(plugin.config, null, 2),
    };
  });

  return rows;
}

function AgentEditForm({
  agentId,
  agentName,
  folder,
  isDefault,
  hasAgentMd,
  onUpdate,
  onBack,
}: {
  agentId: string;
  agentName: string;
  folder?: string;
  isDefault?: boolean;
  hasAgentMd?: boolean;
  onUpdate?: () => void;
  onBack?: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: models = [] } = useModels();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Agent Config (YAML fields)
  const [name, setName] = useState(agentName);
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [subscribeText, setSubscribeText] = useState("");
  const [pluginRows, setPluginRows] = useState<PluginRow[]>([]);
  
  // AGENT.md content
  const [mdContent, setMdContent] = useState("");
  const isCodeOnlyAgent = !isDefault && hasAgentMd === false;

  useEffect(() => {
    if (isCodeOnlyAgent) {
      setLoading(false);
      setName(agentName);
      setDescription("Code-only agent");
      return;
    }

    setLoading(true);
    setError(null);
    
    const promises = [];
    const effectiveName = isDefault ? "default" : agentId;
    
    if (isDefault) {
      promises.push(
        api.getConfig()
          .then((config) => {
            setModel(config.model || "");
            setName(config.name || agentName);
            setDescription(config.description || "");
          })
      );
    } else {
      promises.push(
        api.getAgentConfig(effectiveName)
          .then((config) => {
            setName(config.name || agentName);
            setDescription(config.description || "");
            setModel(config.model || "");
            setSubscribeText((config.subscribe || []).join(", "));
            setPluginRows(configToPluginRows(config));
          })
      );
    }
    
    promises.push(
      api.getAgentMd(effectiveName)
        .then((md) => setMdContent(md))
        .catch(() => setMdContent("")) // Ignore errors for MD
    );

    Promise.all(promises)
      .catch((err) => {
        console.error(err);
        setError("Failed to load agent details");
      })
      .finally(() => setLoading(false));
  }, [agentId, agentName, isDefault, isCodeOnlyAgent]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    const effectiveName = isDefault ? "default" : agentId;
    try {
      if (isDefault) {
        await api.updateConfig({ 
          model: model.trim() || undefined,
          name: name.trim() || undefined,
          description: description.trim() || undefined
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
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

        if (!name.trim() || !description.trim()) {
          setError("Name and description are required");
          setSaving(false);
          return;
        }

        await api.updateAgentConfig(effectiveName, {
          name: name.trim(),
          description: description.trim(),
          model: model.trim() || undefined,
          plugins,
          subscribe,
        });
      }

      await api.updateAgentMd(effectiveName, mdContent);
      
      await queryClient.invalidateQueries({ queryKey: ["agents"] });
      onUpdate?.();
    } catch (err) {
      console.error(err);
      setError("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const selectedPluginNames = pluginRows.map((row) => row.name).filter(Boolean);
  const nextPluginToAdd = OFFICIAL_PLUGINS.find((plugin) => !selectedPluginNames.includes(plugin.name));

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
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
        <div className="flex items-center justify-between border-b border-border/50 px-6 py-4 bg-background/50 backdrop-blur-sm sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors mr-1"
              title="Back to agents"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <AgentAvatar name={agentId} className="w-8 h-8 rounded-lg" />
            <h2 className="text-lg font-semibold tracking-tight">{agentName}</h2>
            <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-500 text-[10px] font-bold uppercase tracking-wider">Code Only</span>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center p-12 text-center overflow-auto">
          <div className="max-w-md flex flex-col gap-6 items-center">
            <div className="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center text-purple-500">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-xl font-semibold text-foreground">Code-only Agent</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                This agent has no <code>AGENT.md</code>. To modify its behavior, capabilities, or configuration, edit files directly in:
              </p>
              <div className="mt-2 p-3 rounded-xl bg-muted/50 border border-border/50 font-mono text-[11px] text-foreground/80 break-all text-left flex items-center justify-between group">
                <code>{folder || "(folder unavailable)"}</code>
                <button 
                  onClick={() => folder && api.openFolder(folder)}
                  disabled={!folder}
                  className="ml-2 p-1.5 rounded-lg hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
                  title="Open folder"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full mt-4">
              <div className="p-4 rounded-2xl border border-border/40 bg-muted/10 text-left">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1">Definition</span>
                <p className="text-xs text-muted-foreground">Look for an exported <code>agent</code> definition in <code>index.ts</code> or <code>index.js</code>.</p>
              </div>
              <div className="p-4 rounded-2xl border border-border/40 bg-muted/10 text-left">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1">Dependencies</span>
                <p className="text-xs text-muted-foreground">Managed via <code>package.json</code> in the agent folder.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="flex items-center justify-between border-b border-border/50 px-6 py-4 bg-background/50 backdrop-blur-sm sticky top-0 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors mr-1"
            title="Back to agents"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <AgentAvatar name={isDefault ? "default" : agentId} className="w-8 h-8 rounded-lg" />
          <h2 className="text-lg font-semibold tracking-tight">{agentName}</h2>
          {isDefault && <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 text-[10px] font-bold uppercase tracking-wider">Default</span>}
        </div>
        <div className="flex items-center gap-3">
           <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-foreground px-5 py-2 text-[13px] font-medium text-background transition-all duration-150 hover:opacity-80 disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-row overflow-hidden relative">
        {/* Main Content - Markdown Instructions */}
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <div className="flex-1 overflow-auto p-6 flex flex-col gap-6">
            {error && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300 shrink-0">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-3 h-full max-w-7xl mx-auto w-full">
              <div className="flex items-center justify-between px-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Instructions (AGENT.md)</label>
                <span className="text-[11px] text-muted-foreground/60">Instructions for the agent</span>
              </div>
              <textarea
                value={mdContent}
                onChange={(e) => setMdContent(e.target.value)}
                className="flex-1 w-full rounded-2xl border border-border/60 bg-background/50 px-8 py-8 font-mono text-sm focus:outline-none focus:border-foreground/30 transition-all leading-relaxed resize-none shadow-sm"
                placeholder="# Agent Instructions&#10;&#10;Explain what this agent does and how it should be used..."
              />
            </div>
          </div>
        </div>

        {/* Right Sidebar - Configuration */}
        <div className="w-[380px] border-l border-border/50 bg-muted/5 flex flex-col h-full shrink-0 animate-in slide-in-from-right duration-300">
          <div className="p-4 border-b border-border/50 bg-background/50 flex flex-col gap-1 shrink-0">
            <h3 className="text-sm font-semibold tracking-tight">Configuration</h3>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Agent Details & Plugins</p>
          </div>
          
          <div className="flex-1 overflow-auto p-5 flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-xl border border-border/60 bg-background/50 px-4 py-2.5 text-sm transition-all focus:border-foreground/30 focus:outline-none"
                placeholder="agent name"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Model (optional)</label>
              <ModelSelector
                value={model}
                models={models}
                onChange={setModel}
                placeholder="openai/gpt-4o"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="rounded-xl border border-border/60 bg-background/50 px-4 py-2.5 text-sm transition-all focus:border-foreground/30 focus:outline-none"
                placeholder="short summary"
              />
            </div>

            {!isDefault && (
              <>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Plugins</label>
                    <button
                      onClick={() => {
                        if (!nextPluginToAdd) return;
                        setPluginRows((rows) => [...rows, { name: nextPluginToAdd.name, configText: "" }]);
                      }}
                      disabled={!nextPluginToAdd}
                      className="rounded-lg border border-border/60 px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      + Add
                    </button>
                  </div>
                  <div className="flex flex-col gap-3">
                    {pluginRows.map((row, index) => (
                      <div key={index} className="rounded-xl border border-border/60 bg-background/50 p-3 group transition-all hover:bg-muted/10 shadow-sm">
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
                            {[...OFFICIAL_PLUGINS, ...(!OFFICIAL_PLUGINS.some((p) => p.name === row.name) && row.name ? [{ name: row.name, description: "Custom plugin (existing)" }] : [])].map((plugin) => {
                              const alreadySelectedElsewhere = pluginRows.some((item, itemIndex) => itemIndex !== index && item.name === plugin.name);
                              return (
                                <option key={plugin.name} value={plugin.name} disabled={alreadySelectedElsewhere}>
                                  {plugin.name}
                                </option>
                              );
                            })}
                          </select>
                          <button
                            onClick={() => setPluginRows((rows) => rows.filter((_, i) => i !== index))}
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors"
                            title="Remove plugin"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                          </button>
                        </div>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wider">
                            Config (JSON)
                          </summary>
                          <textarea
                            value={row.configText}
                            onChange={(e) => {
                              const next = [...pluginRows];
                              next[index] = { ...next[index], configText: e.target.value };
                              setPluginRows(next);
                            }}
                            className="mt-2 min-h-20 w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 font-mono text-[11px] focus:outline-none focus:border-foreground/30"
                            placeholder='{ "key": "value" }'
                          />
                        </details>
                      </div>
                    ))}
                    {pluginRows.length === 0 && (
                      <div className="rounded-xl border border-dashed border-border/60 py-4 text-center text-[11px] text-muted-foreground/60 bg-muted/5">
                        No plugins.
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subscribed Events</label>
                  <input
                    value={subscribeText}
                    onChange={(e) => setSubscribeText(e.target.value)}
                    className="rounded-xl border border-border/60 bg-background/50 px-4 py-2.5 text-sm transition-all focus:border-foreground/30 focus:outline-none"
                    placeholder="event:chat:message, ..."
                  />
                  <p className="text-[10px] text-muted-foreground/60 italic px-1 leading-tight">Comma-separated list of events this agent reacts to.</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );

}

export function AgentsPage() {
  const { navigate, path } = useSession();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"installed" | "marketplace-agents" | "marketplace-plugins">("installed");
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [installingAgentId, setInstallingAgentId] = useState<string | null>(null);
  const [installingPluginId, setInstallingPluginId] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
  });
  const { data: plugins = [], isLoading: loadingPlugins } = useQuery({
    queryKey: ["plugins"],
    queryFn: api.getInstalledPlugins,
  });
  const { data: marketplaceAgents = [], isLoading: loadingMarketplaceAgents } = useQuery({
    queryKey: ["marketplace", "agents"],
    queryFn: api.getMarketplaceAgents,
  });
  const { data: marketplacePlugins = [], isLoading: loadingMarketplacePlugins } = useQuery({
    queryKey: ["marketplace", "plugins"],
    queryFn: api.getMarketplacePlugins,
  });

  const selectedAgentId = useMemo(() => {
    return new URLSearchParams(path).get("agentId");
  }, [path]);

  const setSelectedAgentId = (id: string | null) => {
    const params = new URLSearchParams(path);
    if (id) {
      params.set("agentId", id);
    } else {
      params.delete("agentId");
    }
    navigate("?" + params.toString());
  };

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  const handleCreateCustomAgent = () => {
    setShowCreateMenu(false);
    navigate("/?tab=chat&msg=" + encodeURIComponent("/agent-creator I want to create a new agent. Ask me focused questions, then propose the final AGENT.md for approval before writing it."));
  };

  const handleGoToOfficialAgents = () => {
    setShowCreateMenu(false);
    setActiveTab("marketplace-agents");
  };

  const installedAgentKeys = useMemo(() => {
    return new Set(
      agents.map((agent) => [agent.id, agent.name].map((v) => (v || "").toLowerCase())).flat()
    );
  }, [agents]);

  const installedPluginKeys = useMemo(() => {
    return new Set(
      plugins.map((plugin) => [plugin.id, plugin.name].map((v) => (v || "").toLowerCase())).flat()
    );
  }, [plugins]);

  const isAgentInstalled = (item: MarketplaceItem) =>
    installedAgentKeys.has(item.id.toLowerCase()) || installedAgentKeys.has(item.name.toLowerCase());

  const isPluginInstalled = (item: MarketplaceItem) =>
    installedPluginKeys.has(item.id.toLowerCase()) || installedPluginKeys.has(item.name.toLowerCase());

  const handleInstallAgent = async (item: MarketplaceItem) => {
    setInstallError(null);
    setInstallingAgentId(item.id);
    try {
      await api.installMarketplaceAgent(item.id);
      await queryClient.invalidateQueries({ queryKey: ["agents"] });
      await queryClient.invalidateQueries({ queryKey: ["marketplace", "agents"] });
    } catch (err) {
      console.error(err);
      setInstallError(`Failed to install agent "${item.name}"`);
    } finally {
      setInstallingAgentId(null);
    }
  };

  const handleInstallPlugin = async (item: MarketplaceItem) => {
    setInstallError(null);
    setInstallingPluginId(item.id);
    try {
      await api.installMarketplacePlugin(item.id);
      await queryClient.invalidateQueries({ queryKey: ["plugins"] });
      await queryClient.invalidateQueries({ queryKey: ["marketplace", "plugins"] });
    } catch (err) {
      console.error(err);
      setInstallError(`Failed to install plugin "${item.name}"`);
    } finally {
      setInstallingPluginId(null);
    }
  };

  if (selectedAgentId && selectedAgent) {
    return (
      <div className="flex-1 flex flex-col h-full bg-background relative overflow-hidden">
        <AgentEditForm 
          key={selectedAgent.id}
          agentId={selectedAgent.id}
          agentName={selectedAgent.name}
          folder={selectedAgent?.folder}
          isDefault={selectedAgent?.isDefault} 
          hasAgentMd={selectedAgent?.hasAgentMd}
          onBack={() => setSelectedAgentId(null)}
          onUpdate={() => {}}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-auto">
      <div className="max-w-5xl mx-auto w-full flex flex-col gap-8 p-6 md:p-8 lg:p-10">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight leading-none">Agents</h1>
              <span className="px-1.5 py-0.5 rounded-[4px] bg-white/10 text-[9px] font-bold uppercase tracking-[0.05em] text-white/60 mt-0.5">Beta</span>
            </div>
            <p className="text-muted-foreground/80 text-base font-medium leading-tight">
              Install and manage your agents and plugins
            </p>
          </div>

          <div className="relative">
            <button
              onClick={() => setShowCreateMenu((value) => !value)}
              className="rounded-xl bg-foreground px-5 py-2.5 text-[13.5px] font-semibold text-background transition-all duration-150 hover:opacity-90 flex items-center gap-2 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Create Agent
            </button>
            {showCreateMenu && (
              <div className="absolute right-0 mt-2 w-60 rounded-xl border border-border/60 bg-background p-1 shadow-2xl z-20">
                <button
                  onClick={handleGoToOfficialAgents}
                  className="w-full text-left rounded-lg px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
                >
                  Install Official Agent
                </button>
                <button
                  onClick={handleCreateCustomAgent}
                  className="w-full text-left rounded-lg px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
                >
                  Create Custom Agent
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/10 p-1 w-fit">
          <button
            onClick={() => setActiveTab("installed")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${activeTab === "installed" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            Installed
          </button>
          <button
            onClick={() => setActiveTab("marketplace-agents")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${activeTab === "marketplace-agents" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            Marketplace Agents
          </button>
          <button
            onClick={() => setActiveTab("marketplace-plugins")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${activeTab === "marketplace-plugins" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            Marketplace Plugins
          </button>
        </div>

        {installError && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
            {installError}
          </p>
        )}

        {activeTab === "installed" && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Agents</h2>
              {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[1, 2, 4, 5, 6].map((i) => (
                    <div key={i} className="h-20 rounded-2xl bg-muted/10 border border-border/20 animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1 -mx-3">
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => setSelectedAgentId(agent.id)}
                      className="flex items-center gap-3.5 p-3 rounded-[18px] hover:bg-white/5 transition-all group text-left border border-transparent hover:border-white/5"
                    >
                      <div className="relative shrink-0">
                        <AgentAvatar
                          name={agent.isDefault ? "default" : agent.id}
                          className="w-[48px] h-[48px] rounded-[12px] shadow-sm transition-transform group-hover:scale-[1.05]"
                        />
                        {agent.isDefault && (
                          <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-background flex items-center justify-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h3 className="font-semibold text-[15px] tracking-tight truncate">{agent.name}</h3>
                          {!agent.isDefault && agent.hasAgentMd === false && (
                            <span className="px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-500 text-[8px] font-bold uppercase tracking-wider shrink-0 border border-purple-500/20">Code</span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground/60 line-clamp-1 leading-snug font-medium">
                          {agent.description || "No description provided"}
                        </p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/20 group-hover:text-foreground group-hover:translate-x-0.5 transition-all shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Plugins</h2>
              {loadingPlugins ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-20 rounded-2xl bg-muted/10 border border-border/20 animate-pulse" />
                  ))}
                </div>
              ) : plugins.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 py-6 text-center text-sm text-muted-foreground">
                  No plugins installed yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {plugins.map((plugin) => (
                    <div key={plugin.id} className="rounded-2xl border border-border/50 bg-background/40 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-semibold text-sm">{plugin.name}</h3>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/40 border border-border/40 uppercase tracking-wider">
                          Plugin
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground/70 mt-1">{plugin.description || "No description provided"}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "marketplace-agents" && (
          loadingMarketplaceAgents ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-24 rounded-2xl bg-muted/10 border border-border/20 animate-pulse" />
              ))}
            </div>
          ) : marketplaceAgents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 py-8 text-center text-sm text-muted-foreground">
              No official agents found in the marketplace registry.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {marketplaceAgents.map((item) => {
                const installed = isAgentInstalled(item);
                const installing = installingAgentId === item.id;
                return (
                  <div key={item.id} className="rounded-2xl border border-border/50 bg-background/40 p-4 flex flex-col gap-3">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-semibold text-sm">{item.name}</h3>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/40 border border-border/40 uppercase tracking-wider">
                          Agent
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground/70 mt-1">{item.description || "No description provided"}</p>
                    </div>
                    <button
                      onClick={() => void handleInstallAgent(item)}
                      disabled={installed || installing}
                      className="rounded-lg border border-border/60 px-3 py-2 text-xs font-semibold hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {installed ? "Installed" : installing ? "Installing..." : "Install Agent"}
                    </button>
                  </div>
                );
              })}
            </div>
          )
        )}

        {activeTab === "marketplace-plugins" && (
          loadingMarketplacePlugins ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-24 rounded-2xl bg-muted/10 border border-border/20 animate-pulse" />
              ))}
            </div>
          ) : marketplacePlugins.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 py-8 text-center text-sm text-muted-foreground">
              No official plugins found in the marketplace registry.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {marketplacePlugins.map((item) => {
                const installed = isPluginInstalled(item);
                const installing = installingPluginId === item.id;
                return (
                  <div key={item.id} className="rounded-2xl border border-border/50 bg-background/40 p-4 flex flex-col gap-3">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-semibold text-sm">{item.name}</h3>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/40 border border-border/40 uppercase tracking-wider">
                          Plugin
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground/70 mt-1">{item.description || "No description provided"}</p>
                    </div>
                    <button
                      onClick={() => void handleInstallPlugin(item)}
                      disabled={installed || installing}
                      className="rounded-lg border border-border/60 px-3 py-2 text-xs font-semibold hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {installed ? "Installed" : installing ? "Installing..." : "Install Plugin"}
                    </button>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}
