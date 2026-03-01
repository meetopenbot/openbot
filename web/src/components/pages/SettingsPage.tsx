import { useState, useEffect } from "react";
import { useTheme } from "@melony/ui-shadcn";
import { useConfig, useUpdateConfig } from "../../hooks/use-config";

type Theme = "light" | "dark" | "system";
const MASKED_KEY_VALUE = "**********";

const THEME_OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "monitor" },
];

export function SettingsPage() {
  const { data: config } = useConfig();
  const updateConfig = useUpdateConfig();
  const { theme, setTheme } = useTheme();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiEditing, setOpenaiEditing] = useState(false);
  const [anthropicEditing, setAnthropicEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) {
      setName(config.name || "");
      setDescription(config.description || "");
    }
  }, [config]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateConfig.mutate(
      {
        name: name || undefined,
        description: description || undefined,
        openai_api_key: openaiKey || undefined,
        anthropic_api_key: anthropicKey || undefined,
      },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  };

  if (!config) return null;

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-xl flex-col gap-10 px-6 py-10 animate-in fade-in">
          {/* Header */}
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
            <p className="text-[13px] text-muted-foreground/70">
              Manage your OpenBot configuration
            </p>
          </div>

          {/* Theme */}
          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-0.5">
              <h3 className="text-[13px] font-medium">Appearance</h3>
              <p className="text-xs text-muted-foreground/60">
                Choose your preferred color theme
              </p>
            </div>
            <div className="flex gap-2">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTheme(opt.value)}
                  className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-medium transition-all duration-150 ${
                    theme === opt.value
                      ? "border-foreground/15 bg-foreground/4 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                      : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                  }`}
                >
                  <ThemeIcon type={opt.icon} />
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* API Keys */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-8">
            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-[13px] font-medium">Default Agent</h3>
                <p className="text-xs text-muted-foreground/60">
                  Customize the name and description of the main orchestrator
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground/70">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="OpenBot"
                    className="w-full rounded-xl border border-border/60 bg-transparent px-4 py-2.5 text-[13px] placeholder:text-muted-foreground/40 transition-colors focus:border-foreground/20 focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground/70">Description</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="The main orchestrator and system settings"
                    className="w-full rounded-xl border border-border/60 bg-transparent px-4 py-2.5 text-[13px] placeholder:text-muted-foreground/40 transition-colors focus:border-foreground/20 focus:outline-none"
                  />
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-[13px] font-medium">API Keys</h3>
                <p className="text-xs text-muted-foreground/60">
                  Your keys are stored locally and never shared
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground/70">OpenAI</label>
                  <input
                    type="password"
                    value={openaiEditing ? openaiKey : openaiKey || (config.hasOpenAIKey ? MASKED_KEY_VALUE : "")}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    onFocus={() => {
                      if (!openaiEditing && !openaiKey && config.hasOpenAIKey) {
                        setOpenaiKey("");
                      }
                      setOpenaiEditing(true);
                    }}
                    onBlur={() => {
                      if (!openaiKey) setOpenaiEditing(false);
                    }}
                    placeholder="sk-..."
                    className="w-full rounded-xl border border-border/60 bg-transparent px-4 py-2.5 text-[13px] placeholder:text-muted-foreground/40 transition-colors focus:border-foreground/20 focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground/70">Anthropic</label>
                  <input
                    type="password"
                    value={anthropicEditing ? anthropicKey : anthropicKey || (config.hasAnthropicKey ? MASKED_KEY_VALUE : "")}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    onFocus={() => {
                      if (!anthropicEditing && !anthropicKey && config.hasAnthropicKey) {
                        setAnthropicKey("");
                      }
                      setAnthropicEditing(true);
                    }}
                    onBlur={() => {
                      if (!anthropicKey) setAnthropicEditing(false);
                    }}
                    placeholder="sk-ant-..."
                    className="w-full rounded-xl border border-border/60 bg-transparent px-4 py-2.5 text-[13px] placeholder:text-muted-foreground/40 transition-colors focus:border-foreground/20 focus:outline-none"
                  />
                </div>
              </div>
            </section>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={updateConfig.isPending}
                className="rounded-xl bg-foreground px-5 py-2 text-[13px] font-medium text-background transition-all duration-150 hover:opacity-80 disabled:opacity-40"
              >
                {saved ? "Saved" : updateConfig.isPending ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>

        </div>
    </div>
  );
}

function ThemeIcon({ type }: { type: string }) {
  const props = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  if (type === "sun") return (
    <svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" /><path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" /><path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );

  if (type === "moon") return (
    <svg {...props}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );

  return (
    <svg {...props}>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  );
}
