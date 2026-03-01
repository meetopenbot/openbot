import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../hooks/use-session";
import { api, type AgentConfig } from "../../lib/api";
import { AgentAvatar } from "../AgentAvatar";
import { ModelSelector } from "../ModelSelector";
import { useModels } from "../../hooks/use-models";
import { cn } from "../../lib/utils";

type PluginRow = {
  name: string;
  configText: string;
};

const OFFICIAL_PLUGINS: Array<{ name: string; description: string }> = [
  { name: "shell", description: "Execute shell commands" },
  { name: "file-system", description: "Read and write files" },
  { name: "approval", description: "Require approval for sensitive actions" },
  { name: "browser", description: "Web automation and browsing tools" },
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

function AgentEditForm({ agentName, isDefault, onUpdate }: { agentName: string; isDefault?: boolean; onUpdate?: () => void }) {
  const queryClient = useQueryClient();
  const { data: models = [] } = useModels();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Agent Config (YAML fields)
  const [name, setName] = useState(agentName);
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [subscribeText, setSubscribeText] = useState("");
  const [pluginRows, setPluginRows] = useState<PluginRow[]>([]);
  
  // AGENT.md content
  const [mdContent, setMdContent] = useState("");

  useEffect(() => {
    setLoading(true);
    setError(null);
    
    const promises = [];
    const effectiveName = isDefault ? "default" : agentName;
    
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
            setSystemPrompt(config.systemPrompt || "");
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
  }, [agentName, isDefault]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    const effectiveName = isDefault ? "default" : agentName;
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

        if (!name.trim() || !description.trim() || !systemPrompt.trim()) {
          setError("Name, description, and system prompt are required");
          setSaving(false);
          return;
        }

        await api.updateAgentConfig(effectiveName, {
          name: name.trim(),
          description: description.trim(),
          model: model.trim() || undefined,
          plugins,
          systemPrompt,
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

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="flex items-center justify-between border-b border-border/50 px-6 py-4 bg-background/50 backdrop-blur-sm sticky top-0 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <AgentAvatar name={isDefault ? "default" : agentName} className="w-8 h-8 rounded-lg" />
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
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Markdown Instructions (AGENT.md)</label>
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
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">System Prompt</label>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    className="min-h-32 w-full rounded-xl border border-border/60 bg-background/50 px-4 py-3 text-sm focus:outline-none focus:border-foreground/30 transition-all leading-relaxed"
                    placeholder="Define behavior..."
                  />
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
  const { navigate } = useSession();
  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
  });

  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedAgentName && agents.length > 0) {
      setSelectedAgentName(agents[0].name);
    }
  }, [agents, selectedAgentName]);

  const selectedAgent = agents.find(a => a.name === selectedAgentName);

  const handleCreateAgent = () => {
    navigate("/?tab=chat&msg=" + encodeURIComponent("/agent-creator I want to create a new agent. Ask me focused questions, then propose the final AGENT.md for approval before writing it."));
  };

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* Sidebar */}
      <div className="w-72 border-r border-border/50 bg-muted/5 flex flex-col h-full shrink-0">
        <div className="p-6 border-b border-border/50 flex flex-col gap-1">
          <h2 className="text-lg font-bold tracking-tight">Agents</h2>
          <p className="text-[12px] text-muted-foreground/70 leading-tight">
            Vertical list of all active agents
          </p>
        </div>
        
        <div className="flex-1 overflow-auto p-3 flex flex-col gap-1">
          {isLoading ? (
            <div className="p-4 text-center text-xs text-muted-foreground">Loading agents...</div>
          ) : (
            <>
              {agents.map((agent) => (
                <button
                  key={agent.name}
                  onClick={() => setSelectedAgentName(agent.name)}
                  className={cn(
                    "flex items-center gap-3 w-full p-3 rounded-xl transition-all text-left group",
                    selectedAgentName === agent.name 
                      ? "bg-muted/40" 
                      : "hover:bg-muted/40 text-foreground"
                  )}
                >
                  <AgentAvatar 
                    name={agent.isDefault ? "default" : agent.name} 
                    className={cn(
                      "w-9 h-9 rounded-lg transition-transform",
                      selectedAgentName === agent.name ? "scale-105" : "group-hover:scale-105"
                    )} 
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="text-[13px] font-semibold truncate">{agent.name}</span>
                    <span className={cn(
                      "text-[11px] truncate leading-tight"
                    )}>
                      {agent.description}
                    </span>
                  </div>
                </button>
              ))}
              
              <button
                onClick={handleCreateAgent}
                className="mt-4 flex items-center justify-center gap-2 w-full p-3 rounded-xl border border-dashed border-border/60 text-[13px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-all"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                Create New Agent
              </button>
            </>
          )}
        </div>
        
        <div className="p-4 border-t border-border/50">
          <div className="bg-muted/10 rounded-xl p-3 border border-border/40">
             <p className="text-[11px] text-muted-foreground leading-relaxed">
               OpenBot agents are defined in <code>~/.openbot/agents</code> using YAML and Markdown files.
             </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full bg-background relative overflow-hidden">
        {selectedAgentName ? (
          <AgentEditForm 
            key={selectedAgentName}
            agentName={selectedAgentName} 
            isDefault={selectedAgent?.isDefault} 
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground p-12 text-center">
            <div className="max-w-xs flex flex-col gap-3">
              <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-2 text-muted-foreground/30">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
              </div>
              <h3 className="text-sm font-semibold text-foreground">No agent selected</h3>
              <p className="text-xs leading-relaxed">Select an agent from the sidebar to view and edit its configuration or instructions.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
