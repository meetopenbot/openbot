import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "../../hooks/use-session";
import { api } from "../../lib/api";
import { AgentAvatar } from "../AgentAvatar";

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

export function AgentsPage() {
  const { navigate } = useSession();
  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
  });

  const [editingAgent, setEditingAgent] = useState<string | null>(null);

  const handleCreateAgent = () => {
    navigate("/?tab=chat&msg=" + encodeURIComponent("/agent-creator I want to build a new agent that..."));
  };

  return (
    <>
      <div className="h-full overflow-auto">
        <div className="mx-auto flex max-w-xl flex-col gap-10 px-6 py-10 animate-in fade-in">
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
                        Edit
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
