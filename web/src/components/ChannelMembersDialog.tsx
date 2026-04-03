import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { AgentAvatar } from "./AgentAvatar";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./ui/dialog";

interface ChannelMembersDialogProps {
  channelId: string;
  channelName: string;
  onClose: () => void;
}

export function ChannelMembersDialog({ channelId, channelName, onClose }: ChannelMembersDialogProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");

  const { data: membersState } = useQuery({
    queryKey: ["channel-members", channelId],
    queryFn: () => api.getChannelMembers(channelId),
  });

  const { data: allAgents } = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.getAgents(),
  });

  const addMemberMutation = useMutation({
    mutationFn: (payload: { memberId: string; name: string }) =>
      api.addChannelMember(channelId, payload),
    onSuccess: () => {
      setError("");
      queryClient.invalidateQueries({ queryKey: ["channel-members", channelId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to add member"),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) => api.removeChannelMember(channelId, memberId),
    onSuccess: () => {
      setError("");
      queryClient.invalidateQueries({ queryKey: ["channel-members", channelId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to remove member"),
  });

  const setManagerMutation = useMutation({
    mutationFn: (managerId: string) => api.setChannelManager(channelId, managerId),
    onSuccess: () => {
      setError("");
      queryClient.invalidateQueries({ queryKey: ["channel-members", channelId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to update manager"),
  });

  const managerId = membersState?.managerId ?? "you";
  const members = membersState?.members ?? [];

  const availableAgents = useMemo(() => {
    if (!allAgents) return [];
    return allAgents.filter((agent) => !members.some((m) => m.id === agent.id));
  }, [allAgents, members]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[96vw] max-w-[680px] rounded-lg border border-border bg-background p-0 shadow-2xl overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-4 px-6 py-4 border-b border-border/50 bg-muted/5">
          <div className="flex min-w-0 flex-col justify-center">
            <DialogTitle className="text-lg font-bold tracking-tight text-foreground leading-none">
              #{channelName} members
            </DialogTitle>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {members.length} {members.length === 1 ? "member" : "members"} in this channel
            </p>
          </div>
          <DialogClose className="inline-flex shrink-0 self-center items-center justify-center rounded-xl p-2 text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </DialogClose>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">Current Members</p>
            <div className="rounded-lg border border-border/50 divide-y divide-border/50">
              {members.map((member) => {
                const agentMeta = member.id === "you" ? undefined : allAgents?.find((a) => a.id === member.id);
                const avatarName = agentMeta?.isDefault ? "default" : member.id;
                return (
                <div key={member.id} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/5 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    {member.id === "you" ? (
                      <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center overflow-hidden shrink-0 border border-border/50">
                        <span className="text-xs font-bold text-muted-foreground">Y</span>
                      </div>
                    ) : (
                      <AgentAvatar
                        name={avatarName}
                        label={member.name}
                        imageUrl={agentMeta?.image}
                        className="w-8 h-8 shrink-0 rounded-md border border-border/50 object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{member.name}</p>
                      <p className="text-[11px] text-muted-foreground">@{member.id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {member.id === managerId ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">manager</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setManagerMutation.mutate(member.id)}
                        className="text-[11px] px-2 py-1 rounded-md border border-border/60 hover:bg-muted/80 hover:border-border transition-all"
                      >
                        Make manager
                      </button>
                    )}
                    {member.id !== "you" && (
                      <button
                        type="button"
                        onClick={() => removeMemberMutation.mutate(member.id)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Remove member"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </div>

          {availableAgents.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">Available Agents</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {availableAgents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => addMemberMutation.mutate({ memberId: agent.id, name: agent.name })}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border/50 hover:bg-muted/50 text-left transition-colors group"
                  >
                    <AgentAvatar
                      name={agent.isDefault ? "default" : agent.id}
                      label={agent.name}
                      imageUrl={agent.image}
                      className="w-8 h-8 shrink-0 rounded-md border border-border/50 object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{agent.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">@{agent.id}</p>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                        <path d="M5 12h14m-7-7 7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
