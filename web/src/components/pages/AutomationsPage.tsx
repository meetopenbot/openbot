import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AutomationItem } from '../../lib/api';
import { Button } from '../ui/button';

const EXAMPLE_CRONS = ['0 9 * * 1-5', '0 * * * *', '0 18 * * 1'];

type AutomationEditorValue = {
  name: string;
  prompt: string;
  cron: string;
  targetType: 'orchestrator' | 'agent';
  agentName: string;
};

function AutomationModal({
  automation,
  agents,
  onClose,
}: {
  automation: AutomationItem | null;
  agents: Array<{ name: string; description: string; folder?: string }>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isEditing = Boolean(automation);
  const [value, setValue] = useState<AutomationEditorValue>({
    name: automation?.name ?? '',
    prompt: automation?.prompt ?? '',
    cron: automation?.cron ?? '0 9 * * 1-5',
    targetType: automation?.targetType ?? 'orchestrator',
    agentName: automation?.agentName ?? agents[0]?.name ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['automations'] });

  const save = async () => {
    if (!value.name.trim() || !value.prompt.trim() || !value.cron.trim()) {
      setError('Name, cron, and prompt are required.');
      return;
    }
    if (value.targetType === 'agent' && !value.agentName.trim()) {
      setError('Select an agent when target is Specific Agent.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: value.name.trim(),
        prompt: value.prompt.trim(),
        cron: value.cron.trim(),
        targetType: value.targetType,
        agentName: value.targetType === 'agent' ? value.agentName.trim() : undefined,
      };

      if (automation) {
        await api.updateAutomation(automation.id, payload);
      } else {
        await api.createAutomation(payload);
      }

      await refresh();
      onClose();
    } catch {
      setError(isEditing ? 'Failed to update automation.' : 'Failed to create automation.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex w-full max-w-2xl flex-col gap-4 rounded-2xl border border-border/50 bg-background p-6 shadow-xl animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            {isEditing ? `Edit ${automation?.name}` : 'Create Automation'}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
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
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="flex max-h-[65vh] flex-col gap-4 overflow-auto pr-1">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <input
              value={value.name}
              onChange={(e) => setValue((prev) => ({ ...prev, name: e.target.value }))}
              className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
              placeholder="Daily standup summary"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Run With</label>
              <select
                value={value.targetType}
                onChange={(e) =>
                  setValue((prev) => ({
                    ...prev,
                    targetType: e.target.value as 'orchestrator' | 'agent',
                  }))
                }
                className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
              >
                <option value="orchestrator">Orchestrator</option>
                <option value="agent">Specific Agent</option>
              </select>
            </div>

            {value.targetType === 'agent' && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Agent</label>
                <select
                  value={value.agentName}
                  onChange={(e) => setValue((prev) => ({ ...prev, agentName: e.target.value }))}
                  className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                >
                  {agents.map((agent) => (
                    <option key={agent.name} value={agent.name}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Cron</label>
            <input
              value={value.cron}
              onChange={(e) => setValue((prev) => ({ ...prev, cron: e.target.value }))}
              className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
              placeholder="0 9 * * 1-5"
            />
            <p className="text-[11px] text-muted-foreground/70">
              Examples: {EXAMPLE_CRONS.join('  |  ')}
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Prompt</label>
            <textarea
              value={value.prompt}
              onChange={(e) => setValue((prev) => ({ ...prev, prompt: e.target.value }))}
              className="min-h-36 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
              placeholder="Summarize unresolved issues from yesterday's work and prepare a short standup note."
            />
          </div>
        </div>

        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AutomationsPage() {
  const queryClient = useQueryClient();
  const { data: automations = [], isLoading } = useQuery({
    queryKey: ['automations'],
    queryFn: api.getAutomations,
  });
  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: api.getAgents,
  });

  const [editingAutomation, setEditingAutomation] = useState<AutomationItem | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['automations'] });

  const toggleEnabled = async (item: AutomationItem) => {
    setError(null);
    try {
      await api.updateAutomation(item.id, { enabled: !item.enabled });
      await refresh();
    } catch {
      setError('Failed to update automation status.');
    }
  };

  const removeAutomation = async (id: string) => {
    setError(null);
    try {
      await api.deleteAutomation(id);
      await refresh();
    } catch {
      setError('Failed to delete automation.');
    }
  };

  return (
    <>
      <div className="h-full overflow-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10 animate-in fade-in">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-semibold tracking-tight">Automations</h2>
            <p className="text-[13px] text-muted-foreground/70">
              Create scheduled tasks and choose whether they run through the orchestrator or a
              specific agent.
            </p>
          </div>

          <section className="flex flex-col gap-4 pb-8">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-[13px] font-medium">Saved Automations</h3>
                <p className="text-xs text-muted-foreground/60">
                  Manage your scheduled automations
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(true)}
                className="rounded-xl border border-foreground/10 bg-foreground/5 px-4 py-2 text-[13px] font-medium text-foreground transition-all hover:bg-foreground/10"
              >
                Create Automation
              </button>
            </div>

            {error && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
                {error}
              </p>
            )}

            {isLoading ? (
              <p className="py-4 text-center text-[13px] text-muted-foreground/50">
                Loading automations...
              </p>
            ) : automations.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-muted-foreground/50">
                No automations yet
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {automations.map((automation) => (
                  <div
                    key={automation.id}
                    className="flex h-full flex-col gap-3 rounded-xl border border-border/50 p-4 transition-colors hover:border-border"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="truncate text-sm font-medium">{automation.name}</h4>
                        <p className="mt-1 text-xs font-mono text-muted-foreground/70">
                          {automation.cron}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          automation.enabled
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {automation.enabled ? 'Enabled' : 'Paused'}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground/75">
                      {automation.targetType === 'agent'
                        ? `Agent: ${automation.agentName}`
                        : 'Target: Orchestrator'}
                    </p>

                    <p className="text-xs text-muted-foreground/85">{automation.prompt}</p>

                    <div className="relative mt-auto self-end">
                      <details className="group">
                        <summary className="list-none cursor-pointer rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground transition-all duration-150 hover:bg-muted/50 hover:text-foreground">
                          Actions
                        </summary>
                        <div className="absolute right-0 z-10 mt-1 min-w-44 rounded-lg border border-border/60 bg-background p-1 shadow-lg">
                          <button
                            onClick={(e) => {
                              setEditingAutomation(automation);
                              e.currentTarget.closest('details')?.removeAttribute('open');
                            }}
                            className="block w-full rounded-md px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          >
                            Edit
                          </button>
                          <button
                            onClick={(e) => {
                              void toggleEnabled(automation);
                              e.currentTarget.closest('details')?.removeAttribute('open');
                            }}
                            className="block w-full rounded-md px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          >
                            {automation.enabled ? 'Pause' : 'Enable'}
                          </button>
                          <button
                            onClick={(e) => {
                              void removeAutomation(automation.id);
                              e.currentTarget.closest('details')?.removeAttribute('open');
                            }}
                            className="block w-full rounded-md px-3 py-2 text-left text-xs text-red-500 hover:bg-red-500/10"
                          >
                            Delete
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

      {showCreateModal && (
        <AutomationModal
          automation={null}
          agents={agents}
          onClose={() => setShowCreateModal(false)}
        />
      )}
      {editingAutomation && (
        <AutomationModal
          automation={editingAutomation}
          agents={agents}
          onClose={() => setEditingAutomation(null)}
        />
      )}
    </>
  );
}
