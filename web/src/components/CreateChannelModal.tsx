import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { AgentAvatar } from './AgentAvatar';
import { Dialog, DialogClose, DialogContent, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';

interface CreateChannelModalProps {
  onClose: () => void;
  onCreated: (channelId: string) => void;
}

export function CreateChannelModal({ onClose, onCreated }: CreateChannelModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [managerId, setManagerId] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: api.getAgents,
  });

  const selectableAgents = useMemo(() => agents, [agents]);

  const createChannelMutation = useMutation({
    mutationFn: async (payload: { channelName: string; manager: string; members: string[] }) => {
      const created = await api.createChannel(payload.channelName);
      const channelId = created.channel.id;

      const agentNameById = new Map(
        selectableAgents.map((agent) => [agent.id, agent.name] as const),
      );

      const uniqueMembers = Array.from(new Set(payload.members));
      for (const memberId of uniqueMembers) {
        const memberName = agentNameById.get(memberId);
        if (!memberName) continue;
        await api.addChannelMember(channelId, { memberId, name: memberName });
      }

      if (payload.manager) {
        await api.setChannelManager(channelId, payload.manager);
      }

      return channelId;
    },
    onSuccess: (channelId) => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['channel-members', channelId] });
      onCreated(channelId);
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to create channel');
    },
  });

  const toggleMember = (id: string, checked: boolean) => {
    setSelectedMemberIds((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((memberId) => memberId !== id);
    });
  };

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Channel name is required');
      return;
    }
    if (!managerId) {
      setError('Select a manager bot');
      return;
    }

    const members = Array.from(new Set([...selectedMemberIds, managerId]));
    await createChannelMutation.mutateAsync({
      channelName: trimmedName,
      manager: managerId,
      members,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[96vw] max-w-[640px] rounded-lg border border-border bg-background p-0 shadow-2xl overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-4 px-6 py-4 border-b border-border/50 bg-muted/5">
          <div className="flex min-w-0 flex-col justify-center">
            <DialogTitle className="text-lg font-bold tracking-tight text-foreground leading-none">
              Create channel
            </DialogTitle>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Pick a manager bot and team members
            </p>
          </div>
          <DialogClose className="inline-flex shrink-0 self-center items-center justify-center rounded-xl p-2 text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </DialogClose>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Channel name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. product-research"
              className="h-9 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Manager bot
            </label>
            <select
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              className="h-9 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
            >
              <option value="">Select manager</option>
              {selectableAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} (@{agent.id})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Team members (optional)
            </p>
            <div className="rounded-lg border border-border/50 divide-y divide-border/50">
              {selectableAgents.map((agent) => {
                const checked = selectedMemberIds.includes(agent.id);
                return (
                  <label
                    key={agent.id}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-muted/30 cursor-pointer"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <AgentAvatar
                        name={agent.isDefault ? 'default' : agent.id}
                        label={agent.name}
                        imageUrl={agent.image}
                        className="size-8 shrink-0 rounded-md border border-border/50 object-cover"
                      />
                      <div className="min-w-0">
                        <p className="text-sm text-foreground truncate">{agent.name}</p>
                        <p className="text-[11px] text-muted-foreground">@{agent.id}</p>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleMember(agent.id, e.target.checked)}
                      className="size-4 accent-primary"
                    />
                  </label>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              The selected manager is always added as a member automatically.
            </p>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" onClick={onClose} variant="outline">
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={createChannelMutation.isPending}>
              {createChannelMutation.isPending ? 'Creating...' : 'Create channel'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
