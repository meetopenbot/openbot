import { useState } from "react";
import { useUpdateConfig } from "../hooks/use-config";
import { PREDEFINED_MODELS } from "../lib/models";

export function Onboarding() {
  const updateConfig = useUpdateConfig();
  const [model, setModel] = useState("openai/gpt-4o-mini");
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateConfig.mutate({
      model,
      openai_api_key: openaiKey || undefined,
      anthropic_api_key: anthropicKey || undefined,
    });
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div className="flex flex-col gap-10 w-full max-w-[400px] px-6 animate-fade-in">
        <div className="flex flex-col gap-4 items-center text-center">
          <div className="size-14 rounded-2xl bg-foreground/4 border border-border/50 flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/60">
              <path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9-9-1.8-9-9 1.8-9 9-9" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-xl font-semibold tracking-tight">Welcome to OpenBot</h1>
            <p className="text-[13px] text-muted-foreground/70 leading-relaxed">
              Let's configure your AI assistant. You can change these later in settings.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground/70">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-xl border border-border/60 bg-transparent px-4 py-2.5 text-[13px] focus:outline-none focus:border-foreground/20 transition-colors appearance-none"
            >
              {PREDEFINED_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground/70">OpenAI API Key</label>
            <input
              type="password"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full rounded-xl border border-border/60 bg-transparent px-4 py-2.5 text-[13px] placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground/70">Anthropic API Key</label>
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full rounded-xl border border-border/60 bg-transparent px-4 py-2.5 text-[13px] placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={updateConfig.isPending}
            className="w-full rounded-xl bg-foreground text-background py-2.5 text-[13px] font-medium hover:opacity-80 transition-all duration-150 disabled:opacity-40 mt-2"
          >
            {updateConfig.isPending ? "Setting up..." : "Get started"}
          </button>
        </form>
      </div>
    </div>
  );
}
