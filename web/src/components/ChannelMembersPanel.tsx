import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

interface ChannelMembersPanelProps {
  channelId: string;
  channelName: string;
  onClose: () => void;
}

export function ChannelMembersPanel({ channelId, channelName, onClose }: ChannelMembersPanelProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');

  const { data: membersState } = useQuery({
    queryKey: ['channel-members', channelId],
    queryFn: () => api.getChannelMembers(channelId),
  });

  const { data: allAgents } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.getAgents(),
  });

  const addMemberMutation = useMutation({
    mutationFn: (payload: { memberId: string; name: string }) =>
      api.addChannelMember(channelId, payload),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['channel-members', channelId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to add member'),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) => api.removeChannelMember(channelId, memberId),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['channel-members', channelId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to remove member'),
  });

  const setManagerMutation = useMutation({
    mutationFn: (managerId: string) => api.setChannelManager(channelId, managerId),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['channel-members', channelId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to update manager'),
  });

  const managerId = membersState?.managerId ?? 'you';
  const members = membersState?.members ?? [];

  const availableAgents = useMemo(() => {
    if (!allAgents) return [];
    return allAgents.filter(
      (agent) => !members.some((member) => member.id === agent.id) && !agent.isDefault,
    );
  }, [allAgents, members]);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="sticky top-0 z-10 border-b border-border/50 bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">#{channelName} members</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {members.length} {members.length === 1 ? 'member' : 'members'} in this channel
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close members panel"
            title="Close"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="space-y-2">
          <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Current members
          </p>
          <div className="divide-y divide-border/50 rounded-lg border border-border/50">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-muted/5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/50 bg-muted">
                    {member.id === 'you' ? (
                      <span className="text-xs font-bold text-muted-foreground">Y</span>
                    ) : (
                      <span className="text-xs font-bold text-muted-foreground">
                        {member.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{member.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">@{member.id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {member.id === managerId ? (
                    <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                      manager
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setManagerMutation.mutate(member.id)}
                      className="rounded-md border border-border/60 px-2 py-1 text-[11px] transition-all hover:border-border hover:bg-muted/80"
                    >
                      Make manager
                    </button>
                  )}
                  {member.id !== 'you' && (
                    <button
                      type="button"
                      onClick={() => removeMemberMutation.mutate(member.id)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      title="Remove member"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {availableAgents.length > 0 && (
          <div className="space-y-2">
            <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Available agents
            </p>
            <div className="space-y-2">
              {availableAgents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => addMemberMutation.mutate({ memberId: agent.id, name: agent.name })}
                  className="flex w-full items-center gap-3 rounded-lg border border-border/50 px-3 py-2 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/50 bg-muted">
                    {agent.image ? (
                      <img
                        src={agent.image}
                        alt={agent.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-xs font-bold text-muted-foreground">
                        {agent.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{agent.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">@{agent.id}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
