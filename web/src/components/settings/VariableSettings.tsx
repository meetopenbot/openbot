import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, AlertCircle, CheckCircle2, Save } from 'lucide-react';
import { api, USER_VARIABLE_SECRET_UNCHANGED } from '../../lib/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';

const VARIABLE_MASK_DISPLAY = '••••••••••••••••';

type VariableRowState = {
  id: string;
  key: string;
  secret: boolean;
  draft: string;
  /** Loaded secret with a value; user has not edited yet — submit unchanged sentinel if still empty */
  committedUnchanged: boolean;
};

function variableRowsFromServer(
  list: Array<{ key: string; secret: boolean; hasValue: boolean; value?: string }>,
): VariableRowState[] {
  return list.map((v) => ({
    id: crypto.randomUUID(),
    key: v.key,
    secret: v.secret,
    draft: v.secret ? '' : (v.value ?? ''),
    committedUnchanged: v.secret && v.hasValue,
  }));
}

export function VariableSettings() {
  const queryClient = useQueryClient();
  const [varRows, setVarRows] = useState<VariableRowState[]>([]);
  const [varValueFocusId, setVarValueFocusId] = useState<string | null>(null);
  const [varsSaved, setVarsSaved] = useState(false);
  const [variablesSaveError, setVariablesSaveError] = useState<string | null>(null);

  const { data: varsData } = useQuery({
    queryKey: ['variables'],
    queryFn: api.getVariables,
  });

  useEffect(() => {
    if (!varsData?.variables) return;
    setVarRows(variableRowsFromServer(varsData.variables));
    setVariablesSaveError(null);
  }, [varsData]);

  const saveVariablesMutation = useMutation({
    mutationFn: () =>
      api.updateVariables(
        varRows.map((r) => ({
          key: r.key.trim(),
          secret: r.secret,
          value:
            r.secret && r.committedUnchanged && r.draft === ''
              ? USER_VARIABLE_SECRET_UNCHANGED
              : r.draft,
        })),
      ),
    onSuccess: async () => {
      setVariablesSaveError(null);
      setVarsSaved(true);
      setTimeout(() => setVarsSaved(false), 2000);
      await queryClient.invalidateQueries({ queryKey: ['variables'] });
    },
    onError: (err: Error) => {
      setVariablesSaveError(err.message || 'Failed to save variables');
    },
  });

  return (
    <section className="flex flex-col gap-6 pb-20">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Variables</h2>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3 gap-1.5"
            onClick={() =>
              setVarRows((prev) => [
                {
                  id: crypto.randomUUID(),
                  key: '',
                  secret: true,
                  draft: '',
                  committedUnchanged: false,
                },
                ...prev,
              ])
            }
          >
            <Plus className="size-3.5" />
            Add variable
          </button>
        </div>
        <p className="text-[13px] text-muted-foreground/70">
          Environment variables stored in{' '}
          <code className="rounded bg-muted/50 px-1 py-0.5 text-[11px]">
            variables.json
          </code>
          . Applied to the server process on save.
        </p>
      </div>

      {variablesSaveError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="size-3.5" />
          {variablesSaveError}
        </div>
      )}

      <div className="rounded-md border border-border/50 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-muted/30 border-b border-border/50">
              <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 w-[35%]">Key</th>
              <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Value</th>
              <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 w-16 text-center">Secret</th>
              <th className="px-4 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {varRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-12 text-center text-xs text-muted-foreground bg-muted/5">
                  No variables yet.
                </td>
              </tr>
            ) : (
              varRows.map((row) => {
                const showMasked =
                  row.secret && row.committedUnchanged && varValueFocusId !== row.id;
                const displayValue = showMasked ? VARIABLE_MASK_DISPLAY : row.draft;
                return (
                  <tr key={row.id} className="group hover:bg-muted/5 transition-colors">
                    <td className="px-3 py-2">
                      <Input
                        value={row.key}
                        onChange={(e) =>
                          setVarRows((prev) =>
                            prev.map((r) =>
                              r.id === row.id ? { ...r, key: e.target.value } : r,
                            ),
                          )
                        }
                        placeholder="KEY"
                        autoComplete="off"
                        spellCheck={false}
                        className="h-8 font-mono text-[11px] bg-transparent border-transparent focus:bg-background focus:border-input shadow-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type={row.secret && !showMasked ? 'password' : 'text'}
                        value={displayValue}
                        onChange={(e) =>
                          setVarRows((prev) =>
                            prev.map((r) =>
                              r.id === row.id
                                ? {
                                    ...r,
                                    draft: e.target.value,
                                    committedUnchanged: false,
                                  }
                                : r,
                            ),
                          )
                        }
                        onFocus={() => setVarValueFocusId(row.id)}
                        onBlur={() =>
                          setVarValueFocusId((id) => (id === row.id ? null : id))
                        }
                        placeholder={row.secret ? '••••••••' : 'value'}
                        autoComplete="off"
                        spellCheck={false}
                        className="h-8 font-mono text-[11px] bg-transparent border-transparent focus:bg-background focus:border-input shadow-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex justify-center">
                        <Checkbox
                          checked={row.secret}
                          onCheckedChange={(checked) =>
                            setVarRows((prev) =>
                              prev.map((r) =>
                                r.id === row.id
                                  ? {
                                      ...r,
                                      secret: !!checked,
                                      committedUnchanged: checked
                                        ? r.committedUnchanged
                                        : false,
                                    }
                                  : r,
                              ),
                            )
                          }
                          className="size-3.5 border-muted-foreground/40 data-[state=checked]:border-primary"
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() =>
                          setVarRows((prev) => prev.filter((r) => r.id !== row.id))
                        }
                        className="rounded-md p-1.5 text-muted-foreground/40 hover:bg-destructive/10 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                        title="Remove variable"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {varRows.length > 0 && (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            disabled={saveVariablesMutation.isPending}
            onClick={() => saveVariablesMutation.mutate()}
            className="min-w-[120px] gap-2"
          >
            {varsSaved ? (
              <>
                <CheckCircle2 className="size-4" />
                Saved
              </>
            ) : saveVariablesMutation.isPending ? (
              'Saving...'
            ) : (
              <>
                <Save className="size-4" />
                Save variables
              </>
            )}
          </Button>
          {varRows.some((r) => r.key === '' || (r.draft === '' && !r.committedUnchanged)) && (
            <span className="text-[11px] text-muted-foreground/50 italic">
              Some fields are empty
            </span>
          )}
        </div>
      )}
    </section>
  );
}
