import { useState, useMemo } from "react";
import { useTheme } from "@melony/ui-shadcn";
import { useConfig, useUpdateConfig } from "../../hooks/use-config";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type MarketplaceItem } from "../../lib/api";
import { ExtensionItem } from "../ExtensionItem";

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
  const queryClient = useQueryClient();

  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiEditing, setOpenaiEditing] = useState(false);
  const [anthropicEditing, setAnthropicEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  const [installingPluginId, setInstallingPluginId] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const { data: plugins = [], isLoading: loadingPlugins } = useQuery({
    queryKey: ["plugins"],
    queryFn: api.getInstalledPlugins,
  });

  const { data: marketplacePlugins = [], isLoading: loadingMarketplacePlugins } = useQuery({
    queryKey: ["marketplace", "plugins"],
    queryFn: api.getMarketplacePlugins,
  });

  const installedPluginKeys = useMemo(() => {
    return new Set(
      plugins.map((plugin) => [plugin.id, plugin.name].map((v) => (v || "").toLowerCase())).flat()
    );
  }, [plugins]);

  const isPluginInstalled = (item: MarketplaceItem) =>
    installedPluginKeys.has(item.id.toLowerCase()) || installedPluginKeys.has(item.name.toLowerCase());

  const handleInstallPlugin = async (item: MarketplaceItem) => {
    setInstallError(null);
    setInstallingPluginId(item.id);
    try {
      await api.installMarketplacePlugin(item.id);
      await queryClient.invalidateQueries({ queryKey: ["plugins"] });
      await queryClient.invalidateQueries({ queryKey: ["marketplace", "plugins"] });
    } catch (err) {
      console.error(err);
      setInstallError(`Failed to install plugin "${item.name}"`);
    } finally {
      setInstallingPluginId(null);
    }
  };

  const recommendedPlugins = useMemo(() => {
    return marketplacePlugins.filter(item =>
      item.tags?.includes("recommended") && !isPluginInstalled(item)
    );
  }, [marketplacePlugins, installedPluginKeys]);

  const otherMarketplacePlugins = useMemo(() => {
    return marketplacePlugins.filter(item =>
      !item.tags?.includes("recommended") && !isPluginInstalled(item)
    );
  }, [marketplacePlugins, installedPluginKeys]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateConfig.mutate(
      {
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

          <section className="flex flex-col gap-6 border-t border-border/40 pt-10">
            <div className="flex flex-col gap-0.5">
              <h3 className="text-[13px] font-medium">Plugins</h3>
              <p className="text-xs text-muted-foreground/60">
                Install and manage system extensions
              </p>
            </div>

            {installError && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
                {installError}
              </p>
            )}

            <div className="flex flex-col gap-8">
              {/* Installed Plugins */}
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-3">Installed</h4>
                {loadingPlugins ? (
                  <div className="flex flex-col gap-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-16 rounded-xl bg-muted/10 border border-border/20 animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 -mx-3">
                    {plugins.map((plugin) => (
                      <ExtensionItem
                        key={plugin.id}
                        id={plugin.id}
                        name={plugin.name}
                        description={plugin.description}
                        type="plugin"
                        isInstalled
                        image={plugin.image}
                      />
                    ))}
                    {plugins.length === 0 && (
                      <div className="py-6 text-center text-xs text-muted-foreground bg-muted/5 rounded-xl border border-dashed border-border/50 mx-3">
                        No plugins installed.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Recommended Plugins */}
              {recommendedPlugins.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-3">Recommended</h4>
                  <div className="flex flex-col gap-1 -mx-3">
                    {recommendedPlugins.map((item) => (
                      <ExtensionItem
                        key={item.id}
                        id={item.id}
                        name={item.name}
                        description={item.description}
                        type="plugin"
                        image={item.image}
                        onInstall={() => handleInstallPlugin(item)}
                        isInstalling={installingPluginId === item.id}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Marketplace Plugins */}
              {otherMarketplacePlugins.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-3">Marketplace</h4>
                  {loadingMarketplacePlugins ? (
                    <div className="flex flex-col gap-2">
                      {[1, 2].map((i) => (
                        <div key={i} className="h-16 rounded-xl bg-muted/10 border border-border/20 animate-pulse" />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1 -mx-3">
                      {otherMarketplacePlugins.map((item) => (
                        <ExtensionItem
                          key={item.id}
                          id={item.id}
                          name={item.name}
                          description={item.description}
                          type="plugin"
                          image={item.image}
                          onInstall={() => handleInstallPlugin(item)}
                          isInstalling={installingPluginId === item.id}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

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
