import { useEffect, useRef } from "react";
import { cn } from "../../lib/utils";
import { AgentAvatar } from "../AgentAvatar";

interface Agent {
  id: string;
  name: string;
  image?: string;
  isDefault?: boolean;
}

interface AgentMentionDropdownProps {
  filteredAgents: Agent[];
  mentionIndex: number;
  onSelect: (agentId: string) => void;
}

export function AgentMentionDropdown({
  filteredAgents,
  mentionIndex,
  onSelect,
}: AgentMentionDropdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      const activeElement = containerRef.current.children[mentionIndex] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [mentionIndex]);

  if (filteredAgents.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 right-0 z-30 mb-1 mx-1 max-h-48 overflow-y-auto rounded-lg border border-border/60 bg-background shadow-xl animate-in fade-in slide-in-from-bottom-2"
    >
      {filteredAgents.map((agent, idx) => (
        <button
          key={agent.id}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(agent.id);
          }}
          className={cn(
            "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors",
            idx === mentionIndex
              ? "bg-muted/60 text-foreground"
              : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
          )}
        >
          <AgentAvatar
            name={agent.isDefault ? "default" : agent.id}
            label={agent.name}
            imageUrl={agent.image}
            className="size-6 shrink-0 rounded-md"
          />
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium truncate">{agent.name}</span>
            <span className="text-[11px] text-muted-foreground/60">@{agent.id}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
