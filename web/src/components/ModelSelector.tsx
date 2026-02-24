import { useEffect, useMemo, useState } from "react";
import type { ModelOption } from "../lib/api";

const CUSTOM_OPTION = "__custom_model__";

interface ModelSelectorProps {
  value: string;
  models: ModelOption[];
  onChange: (model: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ModelSelector({
  value,
  models,
  onChange,
  placeholder = "provider/model (e.g. openai/your-model)",
  disabled = false,
}: ModelSelectorProps) {
  const [isCustom, setIsCustom] = useState(true);
  const hasExactMatch = useMemo(
    () => !!value && models.some((m) => m.id === value),
    [models, value]
  );

  useEffect(() => {
    if (value && !hasExactMatch) {
      setIsCustom(true);
    }
  }, [value, hasExactMatch]);

  if (isCustom) {
    return (
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 rounded-xl border border-border/60 bg-transparent px-4 py-2.5 text-[13px] placeholder:text-muted-foreground/40 transition-colors focus:border-foreground/20 focus:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setIsCustom(false);
            if (!hasExactMatch && models.length > 0) {
              onChange(models[0].id);
            }
          }}
          className="rounded-xl border border-border/60 px-4 text-[13px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-60"
        >
          Use list
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <select
        value={hasExactMatch ? value : ""}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          if (next === CUSTOM_OPTION) {
            setIsCustom(true);
            if (!value) onChange("");
            return;
          }
          onChange(next);
        }}
        className="w-full appearance-none rounded-xl border border-border/60 bg-transparent px-4 py-2.5 pr-10 text-[13px] text-foreground transition-colors focus:border-foreground/20 focus:outline-none disabled:opacity-60"
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} ({m.id})
          </option>
        ))}
        <option value={CUSTOM_OPTION}>Add custom model...</option>
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-muted-foreground/50">
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
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
    </div>
  );
}
