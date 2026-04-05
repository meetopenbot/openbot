import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { XIcon, UsersIcon, FileTextIcon, DatabaseIcon, ScrollTextIcon } from "lucide-react";
import { Textarea } from "./ui/textarea";
import { AgentAvatar } from "./AgentAvatar";

type ChannelTab = "spec" | "participants" | "state" | "events";

export function ChannelSpecSidebar({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ChannelTab>("spec");
  const [editedSpec, setEditedSpec] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const { data: specData, isLoading: isSpecLoading } = useQuery({
    queryKey: ["channelSpec", conversationId],
    queryFn: () => api.getChannelSpec(conversationId),
    enabled: !!conversationId && conversationId.startsWith("channel_"),
  });

  const { data: stateData, isLoading: isStateLoading } = useQuery({
    queryKey: ["conversationState", conversationId],
    queryFn: () => api.getConversationState(conversationId),
    enabled: !!conversationId && tab === "state",
  });

  const { data: eventsRaw, isLoading: isEventsLoading } = useQuery({
    queryKey: ["conversationEventsRaw", conversationId],
    queryFn: () => api.getConversationEventsRaw(conversationId),
    enabled: !!conversationId && tab === "events",
  });

  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
    enabled: tab === "participants",
  });

  const updateSpecMutation = useMutation({
    mutationFn: (spec: string) => api.updateChannelSpec(conversationId, spec),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channelSpec", conversationId] });
      setIsSaving(false);
    },
    onError: () => {
      setIsSaving(false);
    }
  });

  useEffect(() => {
    if (specData?.spec !== undefined) {
      setEditedSpec(specData.spec);
    }
  }, [specData?.spec]);

  const handleSaveSpec = () => {
    setIsSaving(true);
    updateSpecMutation.mutate(editedSpec);
  };

  if (isSpecLoading && tab === "spec") {
    return (
      <div className="flex h-full flex-col bg-background p-4 animate-pulse">
        <div className="h-6 w-32 bg-muted rounded mb-4" />
        <div className="flex-1 bg-muted/30 rounded" />
      </div>
    );
  }

  const participatingAgents = stateData?.participatingAgents || [];

  return (
    <div className="flex h-full flex-col bg-background border-l border-border/50">
      <div className="sticky top-0 z-10 flex items-center border-b border-border/50 bg-background/95 px-4 h-14 backdrop-blur shrink-0">
        <div className="flex items-center justify-between gap-3 w-full">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Channel Info</h2>
            <p className="mt-1 text-xs text-muted-foreground">{conversationId.replace('channel_', '#')}</p>
          </div>
          <div className="flex items-center gap-2">
            {onClose && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="size-8 text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="border-b border-border/50 px-4 shrink-0">
        <div className="flex gap-2">
          <button
            onClick={() => setTab("spec")}
            className={`relative flex items-center gap-1.5 px-1 py-2.5 text-xs font-medium transition-colors ${
              tab === "spec" ? "text-foreground" : "text-muted-foreground hover:text-foreground/70"
            }`}
          >
            <FileTextIcon className="size-3.5" />
            Spec
            {tab === "spec" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground rounded-full" />}
          </button>
          <button
            onClick={() => setTab("participants")}
            className={`relative flex items-center gap-1.5 px-1 py-2.5 text-xs font-medium transition-colors ${
              tab === "participants" ? "text-foreground" : "text-muted-foreground hover:text-foreground/70"
            }`}
          >
            <UsersIcon className="size-3.5" />
            Participants
            {tab === "participants" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground rounded-full" />}
          </button>
          <button
            onClick={() => setTab("state")}
            className={`relative flex items-center gap-1.5 px-1 py-2.5 text-xs font-medium transition-colors ${
              tab === "state" ? "text-foreground" : "text-muted-foreground hover:text-foreground/70"
            }`}
          >
            <DatabaseIcon className="size-3.5" />
            State
            {tab === "state" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground rounded-full" />}
          </button>
          <button
            onClick={() => setTab("events")}
            className={`relative flex items-center gap-1.5 px-1 py-2.5 text-xs font-medium transition-colors ${
              tab === "events" ? "text-foreground" : "text-muted-foreground hover:text-foreground/70"
            }`}
          >
            <ScrollTextIcon className="size-3.5" />
            Events
            {tab === "events" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground rounded-full" />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {tab === "spec" && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar relative">
              <Textarea
                value={editedSpec}
                onChange={(e) => setEditedSpec(e.target.value)}
                className="h-full w-full resize-none bg-transparent text-[13px] leading-relaxed focus-visible:ring-0"
                placeholder="No spec defined for this channel."
              />
            </div>
            <div className="p-4 border-t border-border/50 bg-background/50">
              <Button
                onClick={handleSaveSpec}
                disabled={isSaving || editedSpec === specData?.spec}
                className="w-full"
                size="sm"
              >
                {isSaving ? "Saving..." : "Save Spec"}
              </Button>
            </div>
          </div>
        )}

        {tab === "participants" && (
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            <div className="flex flex-col gap-3">
              {participatingAgents.length > 0 ? (
                participatingAgents.map((agentId: string) => {
                  const agent = agents.find((a: any) => a.id === agentId || a.name === agentId);
                  return (
                    <div key={agentId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 border border-transparent transition-colors">
                      <AgentAvatar
                        name={agentId}
                        label={agent?.name || agentId}
                        imageUrl={agent?.image}
                        className="size-8 rounded-md"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium truncate">{agent?.name || agentId}</span>
                        {agent?.description && (
                          <span className="text-xs text-muted-foreground truncate">{agent.description}</span>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-8">
                  <UsersIcon className="size-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No agents active in this channel yet.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "state" && (
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
        )}

        {tab === "events" && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar relative">
              {isEventsLoading ? (
                <div className="animate-pulse flex flex-col gap-2">
                  <div className="h-4 bg-muted rounded w-1/2" />
                  <div className="h-40 bg-muted rounded w-full" />
                </div>
              ) : (
                <Textarea
                  readOnly
                  value={eventsRaw || ""}
                  className="h-full w-full resize-none bg-transparent text-[11px] font-mono leading-relaxed focus-visible:ring-0 border-0"
                  placeholder="No events found for this channel."
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
