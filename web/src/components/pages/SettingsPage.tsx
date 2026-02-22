import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@melony/ui-shadcn";
import { useConfig, useUpdateConfig } from "../../hooks/use-config";
import { useSession } from "../../hooks/use-session";
import { api } from "../../lib/api";
import { AgentAvatar } from "../AgentAvatar";

type Theme = "light" | "dark" | "system";

const THEME_OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "monitor" },
];

function EditAgentModal({ agentName, onClose }: { agentName: string; onClose: () => void }) {
  const [yaml, setYaml] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getAgentYaml(agentName)
      .then(setYaml)
      .catch((err) => {
        console.error(err);
        setYaml("Error loading agent.yaml");
      })
      .finally(() => setLoading(false));
  }, [agentName]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateAgentYaml(agentName, yaml);
      onClose();
    } catch (err) {
      console.error(err);
      alert("Failed to save agent.yaml");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex w-full max-w-2xl flex-col gap-4 rounded-2xl border border-border/50 bg-background p-6 shadow-xl animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Edit {agentName}/agent.yaml</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        {loading ? (
          <div className="py-12 text-center text-muted-foreground">Loading...</div>
        ) : (
          <textarea
            value={yaml}
            onChange={(e) => setYaml(e.target.value)}
            className="min-h-[400px] w-full resize-y rounded-xl border border-border/60 bg-muted/30 p-4 font-mono text-[13px] text-foreground focus:border-foreground/20 focus:outline-none"
            spellCheck="false"
          />
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

export function SettingsPage() {
  const { data: config } = useConfig();
  const updateConfig = useUpdateConfig();
  const { theme, setTheme } = useTheme();
  const { navigate } = useSession();
  
  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
  });
  
  const { data: models = [] } = useQuery({
    queryKey: ["models"],
    queryFn: api.getModels,
  });

  const [model, setModel] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [isCustomModel, setIsCustomModel] = useState(false);

  useEffect(() => {
    if (config?.model) {
      const isPredefined = models.some((m) => m.id === config.model);
      if (!isPredefined) {
        setIsCustomModel(true);
      }
    }
  }, [config?.model, models]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateConfig.mutate(
      {
        model: model || undefined,
        openai_api_key: openaiKey || undefined,
        anthropic_api_key: anthropicKey || undefined,
      },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  };

  const handleCreateAgent = () => {
    navigate("/?tab=chat&msg=" + encodeURIComponent("/agent-creator I want to build a new agent that..."));
  };

  if (!config) return null;

  return (
    <>
      <div className="h-full overflow-auto">
        <div className="mx-auto flex max-w-xl flex-col gap-10 px-6 py-10 animate-in fade-in">
          {/* Header */}
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
            <p className="text-[13px] text-muted-foreground/70">
              Manage your OpenBot configuration
            </p>
          </div>

          {/* Theme */}
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
                      ? "border-foreground/15 bg-foreground/4 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                      : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                  }`}
                >
                  <ThemeIcon type={opt.icon} />
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          <div className="h-px bg-border/50" />

          {/* Model & API Keys */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-8">
            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-[13px] font-medium">Model</h3>
                <p className="text-xs text-muted-foreground/60">
                  Configure the LLM model for conversations
                </p>
              </div>
              {!isCustomModel ? (
                <div className="relative">
                  <select
                    value={model || config.model || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "custom") {
                        setIsCustomModel(true);
                        setModel("");
                      } else {
                        setModel(val);
                      }
                    }}
                    className="w-full rounded-xl border border-border/60 bg-transparent px-4 py-2.5 pr-10 text-[13px] text-foreground transition-colors focus:border-foreground/20 focus:outline-none appearance-none"
                  >
                    <option value="" disabled>Select a model...</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} ({m.id})
                      </option>
                    ))}
                    <option value="custom">Add Custom...</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-muted-foreground/50">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={config.model || "provider/model (e.g. openai/gpt-4o)"}
                    className="flex-1 rounded-xl border border-border/60 bg-transparent px-4 py-2.5 text-[13px] placeholder:text-muted-foreground/40 transition-colors focus:border-foreground/20 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomModel(false);
                      setModel("");
                    }}
                    className="rounded-xl border border-border/60 px-4 text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </section>

            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-[13px] font-medium">API Keys</h3>
                <p className="text-xs text-muted-foreground/60">
                  Your keys are stored locally and never shared
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground/70">OpenAI</label>
                  <input
                    type="password"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder={config.hasOpenAIKey ? "••••••••••••••••" : "sk-..."}
                    className="w-full rounded-xl border border-border/60 bg-transparent px-4 py-2.5 text-[13px] placeholder:text-muted-foreground/40 transition-colors focus:border-foreground/20 focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground/70">Anthropic</label>
                  <input
                    type="password"
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    placeholder={config.hasAnthropicKey ? "••••••••••••••••" : "sk-ant-..."}
                    className="w-full rounded-xl border border-border/60 bg-transparent px-4 py-2.5 text-[13px] placeholder:text-muted-foreground/40 transition-colors focus:border-foreground/20 focus:outline-none"
                  />
                </div>
              </div>
            </section>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={updateConfig.isPending}
                className="rounded-xl bg-foreground px-5 py-2 text-[13px] font-medium text-background transition-all duration-150 hover:opacity-80 disabled:opacity-40"
              >
                {saved ? "Saved" : updateConfig.isPending ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>

          <div className="h-px bg-border/50" />

          {/* Agents */}
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
                Create Custom Agent
              </button>
            </div>
            
            {agents.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-muted-foreground/50">
                No custom agents installed
              </p>
            ) : (
              <div className="flex flex-col gap-2">
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
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditingAgent(agent.name)}
                        className="rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground transition-all duration-150 hover:bg-muted/50 hover:text-foreground"
                      >
                        Edit YAML
                      </button>
                      <button
                        onClick={() => api.openFolder(agent.folder)}
                        className="rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground transition-all duration-150 hover:bg-muted/50 hover:text-foreground"
                      >
                        Folder
                      </button>
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

function ThemeIcon({ type }: { type: string }) {
  const props = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  if (type === "sun") return (
    <svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" /><path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" /><path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );

  if (type === "moon") return (
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
