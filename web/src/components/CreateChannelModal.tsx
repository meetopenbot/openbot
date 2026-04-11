import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Dialog, DialogClose, DialogContent, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';

interface CreateChannelModalProps {
  onClose: () => void;
  onCreated: (channelId: string) => void;
}

export function CreateChannelModal({ onClose, onCreated }: CreateChannelModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const createChannelMutation = useMutation({
    mutationFn: async (channelName: string) => {
      const created = await api.createChannel(channelName);
      return created.channel.id;
    },
    onSuccess: (channelId) => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      onCreated(channelId);
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to create channel');
    },
  });

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Channel name is required');
      return;
    }
    await createChannelMutation.mutateAsync(trimmedName);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[96vw] max-w-[420px] rounded-lg border border-border bg-background p-0 shadow-2xl overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-4 px-6 py-4 border-b border-border/50 bg-muted/5">
          <DialogTitle className="text-lg font-bold tracking-tight text-foreground leading-none">
            Create channel
          </DialogTitle>
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

        <div className="p-5 space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Channel name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="e.g. product-research"
              autoFocus
              className="h-9 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
            />
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
