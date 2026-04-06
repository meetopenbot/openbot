import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "../../hooks/use-session";
import { api } from "../../lib/api";
import { ExtensionItem } from "../ExtensionItem";
import { AgentEditForm } from "../AgentEditForm";

const Plus = ({ className }: { className?: string }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M5 12h14" /><path d="M12 5v14" /></svg>
);

export function AgentsPage() {
  const { navigate, path } = useSession();

  const { data: agents = [], isLoading: loadingAgents } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
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
    navigate("/?tab=chat&msg=" + encodeURIComponent("/agent-creator I want to create a new agent. Ask me focused questions, then propose the final AGENT.md for approval before writing it."));
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
          onUpdate={() => { }}
        />
      </div>
    );
  }


  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-auto">
      <div className="max-w-5xl mx-auto w-full flex flex-col gap-12 p-6 md:p-8 lg:p-10">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight leading-none">Agents</h1>
              <span className="px-1.5 py-0.5 rounded-[4px] bg-white/10 text-[9px] font-bold uppercase tracking-[0.05em] text-white/60 mt-0.5">Beta</span>
            </div>
            <p className="text-muted-foreground/80 text-base font-medium leading-tight">
              Manage and discover agents for OpenBot
            </p>
          </div>

          <button
            onClick={handleCreateCustomAgent}
            className="rounded-xl bg-foreground px-5 py-2.5 text-[13.5px] font-semibold text-background transition-all duration-150 hover:opacity-90 flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Create Agent
          </button>
        </div>

        {/* Sections */}
        <div className="flex flex-col gap-12">
          {/* Installed Section */}
          <section>
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/50 mb-6 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500/50" />
              Installed
            </h2>
            {loadingAgents ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-20 rounded-2xl bg-muted/10 border border-border/20 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1 -mx-3">
                {agents.map((agent) => (
                  <ExtensionItem
                    key={agent.id}
                    id={agent.id}
                    name={agent.name}
                    description={agent.description}
                    type="agent"
                    isInstalled
                    isDefault={agent.isDefault}
                    isCodeOnly={!agent.isDefault && agent.hasAgentMd === false}
                    image={agent.image}
                    onClick={() => setSelectedAgentId(agent.id)}
                  />
                ))}
                {agents.length === 0 && (
                  <div className="col-span-full py-8 text-center text-sm text-muted-foreground bg-muted/5 rounded-2xl border border-dashed border-border/50 mx-3">
                    No agents installed.
                  </div>
                )}
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}
