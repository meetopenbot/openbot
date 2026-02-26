import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../hooks/use-session";
import { api, type AgentConfig } from "../../lib/api";
import { AgentAvatar } from "../AgentAvatar";

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
  const rows = config.plugins.map((plugin) => {
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

function EditAgentModal({ agentName, onClose }: { agentName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(agentName);
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [subscribeText, setSubscribeText] = useState("");
  const [pluginRows, setPluginRows] = useState<PluginRow[]>([]);

  useEffect(() => {
    api.getAgentConfig(agentName)
      .then((config) => {
        setName(config.name || agentName);
        setDescription(config.description || "");
        setModel(config.model || "");
        setSystemPrompt(config.systemPrompt || "");
        setSubscribeText((config.subscribe || []).join(", "));
        setPluginRows(configToPluginRows(config));
      })
      .catch((err) => {
        console.error(err);
        setError("Failed to load agent config");
      })
      .finally(() => setLoading(false));
  }, [agentName]);

  const handleSave = async () => {
    setError(null);
    const plugins: Array<string | { name: string; config?: unknown }> = [];
    const seenPluginNames = new Set<string>();

    for (const row of pluginRows) {
      const pluginName = row.name.trim();
      if (!pluginName) continue;
      if (seenPluginNames.has(pluginName)) {
        setError(`Plugin "${pluginName}" is selected more than once`);
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
        return;
      }
    }

    const subscribe = subscribeText
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (plugins.length === 0) {
      setError("At least one plugin is required");
      return;
    }
    if (!name.trim() || !description.trim() || !systemPrompt.trim()) {
      setError("Name, description, and system prompt are required");
      return;
    }

    setSaving(true);
    try {
      await api.updateAgentConfig(agentName, {
        name: name.trim(),
        description: description.trim(),
        model: model.trim() || undefined,
        plugins,
        systemPrompt,
        subscribe,
      });
      await queryClient.invalidateQueries({ queryKey: ["agents"] });
      onClose();
    } catch (err) {
      console.error(err);
      setError("Failed to save agent config");
    } finally {
      setSaving(false);
    }
  };

  const selectedPluginNames = pluginRows.map((row) => row.name).filter(Boolean);
  const nextPluginToAdd = OFFICIAL_PLUGINS.find((plugin) => !selectedPluginNames.includes(plugin.name));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex w-full max-w-2xl flex-col gap-4 rounded-2xl border border-border/50 bg-background p-6 shadow-xl animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Edit {agentName}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        {loading ? (
          <div className="py-12 text-center text-muted-foreground">Loading...</div>
        ) : (
          <div className="flex max-h-[65vh] flex-col gap-4 overflow-auto pr-1">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                placeholder="agent name"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                placeholder="short summary"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Model (optional)</label>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                placeholder="openai/gpt-4o"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Plugins</label>
                <button
                  onClick={() => {
                    if (!nextPluginToAdd) return;
                    setPluginRows((rows) => [...rows, { name: nextPluginToAdd.name, configText: "" }]);
                  }}
                  disabled={!nextPluginToAdd}
                  className="rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add Plugin
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground/70">
                Official plugins only for now. Advanced options are optional.
              </p>
              <div className="flex flex-col gap-2">
                {pluginRows.map((row, index) => (
                  <div key={index} className="rounded-lg border border-border/60 p-3">
                    <div className="flex items-center gap-2">
                      <select
                        value={row.name}
                        onChange={(e) => {
                          const next = [...pluginRows];
                          next[index] = { ...next[index], name: e.target.value };
                          setPluginRows(next);
                        }}
                        className="flex-1 rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm"
                      >
                        {[...OFFICIAL_PLUGINS, ...(!OFFICIAL_PLUGINS.some((p) => p.name === row.name) && row.name ? [{ name: row.name, description: "Custom plugin (existing)" }] : [])].map((plugin) => {
                          const alreadySelectedElsewhere = pluginRows.some((item, itemIndex) => itemIndex !== index && item.name === plugin.name);
                          return (
                            <option key={plugin.name} value={plugin.name} disabled={alreadySelectedElsewhere}>
                              {plugin.name} - {plugin.description}
                            </option>
                          );
                        })}
                      </select>
                      <button
                        onClick={() => setPluginRows((rows) => rows.filter((_, i) => i !== index))}
                        className="rounded-md border border-border/60 px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      >
                        Remove
                      </button>
                    </div>
                    <details className="mt-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        Plugin options (advanced)
                      </summary>
                      <textarea
                        value={row.configText}
                        onChange={(e) => {
                          const next = [...pluginRows];
                          next[index] = { ...next[index], configText: e.target.value };
                          setPluginRows(next);
                        }}
                        className="mt-2 min-h-20 w-full rounded-md border border-border/60 bg-background px-3 py-2 font-mono text-xs"
                        placeholder='Optional config as JSON (e.g. { "baseDir": "~/Documents" })'
                      />
                    </details>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Subscribed Events (optional)</label>
              <input
                value={subscribeText}
                onChange={(e) => setSubscribeText(e.target.value)}
                className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                placeholder="event:a, event:b"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">System Prompt</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="min-h-40 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                placeholder="Agent behavior instructions..."
              />
            </div>
          </div>
        )}
        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl px-5 py-2 text-[13px] font-medium text-muted-foreground hover:bg-muted/50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="rounded-xl bg-foreground px-5 py-2 text-[13px] font-medium text-background transition-all duration-150 hover:opacity-80 disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AgentsPage() {
  const { navigate } = useSession();
  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
  });

  const [editingAgent, setEditingAgent] = useState<string | null>(null);

  const handleCreateAgent = () => {
    navigate("/?tab=chat&msg=" + encodeURIComponent("/agent-creator I want to create a new agent. Ask me focused questions, then propose the final agent.yaml for approval before writing it."));
  };

  const handleEditAgentViaChat = (agentName: string) => {
    navigate(
      "/?tab=chat&msg=" +
        encodeURIComponent(
          `/agent-creator I want to update my existing agent "${agentName}". Read its current agent.yaml first, propose changes with a before/after summary, then wait for my explicit approval before writing.`
        )
    );
  };

  return (
    <>
      <div className="h-full overflow-auto">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-10 animate-in fade-in">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Agents</h2>
            <p className="text-[13px] text-muted-foreground/70">
              Manage your installed agents and edit their configuration
            </p>
          </div>

          <section className="flex flex-col gap-4 pb-8">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-[13px] font-medium">Installed Agents</h3>
                <p className="text-xs text-muted-foreground/60">
                  Agents installed in ~/.openbot/agents
                </p>
              </div>
              <button
                onClick={handleCreateAgent}
                className="rounded-xl border border-foreground/10 bg-foreground/5 px-4 py-2 text-[13px] font-medium text-foreground transition-all hover:bg-foreground/10"
              >
                Create via Chat
              </button>
            </div>

            {agents.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-muted-foreground/50">
                No custom agents installed
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {agents.map((agent) => (
                  <div
                    key={agent.name}
                    className="flex items-center justify-between rounded-xl border border-border/50 p-4 transition-colors hover:border-border"
                  >
                    <div className="flex items-center gap-3">
                      <AgentAvatar name={agent.name} className="w-10 h-10 rounded-xl" />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[13px] font-medium">{agent.name}</span>
                        <span className="text-xs text-muted-foreground/60">
                          {agent.description}
                        </span>
                      </div>
                    </div>
                    <div className="relative">
                      <details className="group">
                        <summary className="list-none cursor-pointer rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground transition-all duration-150 hover:bg-muted/50 hover:text-foreground">
                          Actions
                        </summary>
                        <div className="absolute right-0 z-10 mt-1 min-w-40 rounded-lg border border-border/60 bg-background p-1 shadow-lg">
                          <button
                            onClick={(e) => {
                              handleEditAgentViaChat(agent.name);
                              e.currentTarget.closest("details")?.removeAttribute("open");
                            }}
                            className="block w-full rounded-md px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          >
                            Edit via Chat
                          </button>
                          <button
                            onClick={(e) => {
                              setEditingAgent(agent.name);
                              e.currentTarget.closest("details")?.removeAttribute("open");
                            }}
                            className="block w-full rounded-md px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          >
                            Edit via Form
                          </button>
                          <button
                            onClick={(e) => {
                              void api.openFolder(agent.folder);
                              e.currentTarget.closest("details")?.removeAttribute("open");
                            }}
                            className="block w-full rounded-md px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          >
                            Open Folder
                          </button>
                        </div>
                      </details>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {editingAgent && (
        <EditAgentModal agentName={editingAgent} onClose={() => setEditingAgent(null)} />
      )}
    </>
  );
}
