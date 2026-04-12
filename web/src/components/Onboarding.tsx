import { useState } from "react";
import { useUpdateConfig } from "../hooks/use-config";
import { api, type ModelOption, type ModelProvider } from "../lib/api";
import { ModelSelector } from "./ModelSelector";

interface OnboardingProps {
  defaultModelId: string;
  defaultModels: Record<ModelProvider, string>;
}

export function Onboarding({ defaultModelId, defaultModels }: OnboardingProps) {
  const updateConfig = useUpdateConfig();
  const resolveDefaultModelForProvider = (nextProvider: ModelProvider): string => {
    const providerDefault = defaultModels[nextProvider];
    if (providerDefault) return providerDefault;
    return nextProvider === "openai" ? defaultModelId : "";
  };

  const initialProvider = (defaultModelId || "").startsWith("anthropic/") ? "anthropic" : "openai";
  const [provider, setProvider] = useState<ModelProvider>(initialProvider);
  const [model, setModel] = useState(defaultModelId);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");

  const activeKey = provider === "openai" ? openaiKey : anthropicKey;
  const setActiveKey = (value: string) => {
    if (provider === "openai") {
      setOpenaiKey(value);
    } else {
      setAnthropicKey(value);
    }
  };

  const handleProviderChange = (nextProvider: ModelProvider) => {
    setProvider(nextProvider);
    setModels([]);
    setModelsError("");
    setModel(resolveDefaultModelForProvider(nextProvider));
  };

  const handleLoadModels = async () => {
    if (!activeKey.trim()) return;
    setIsLoadingModels(true);
    setModelsError("");

    try {
      const fetched = await api.previewModels({
        provider,
        apiKey: activeKey.trim(),
      });
      setModels(fetched);
      if (fetched.length > 0 && !fetched.some((m) => m.id === model)) {
        setModel(fetched[0].id);
      }
    } catch {
      setModels([]);
      setModelsError("Could not fetch models. You can still enter a custom model ID.");
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateConfig.mutate({
      model: model.trim() || undefined,
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
            <label className="text-xs font-medium text-muted-foreground/70">Provider</label>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as ModelProvider)}
              className="w-full rounded-xl border border-border/60 bg-transparent px-4 py-2.5 text-[13px] focus:outline-none focus:border-foreground/20 transition-colors appearance-none"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground/70">
              {provider === "openai" ? "OpenAI API Key" : "Anthropic API Key"}
            </label>
            <input
              type="password"
              value={activeKey}
              onChange={(e) => setActiveKey(e.target.value)}
              placeholder={provider === "openai" ? "sk-..." : "sk-ant-..."}
              className="w-full rounded-xl border border-border/60 bg-transparent px-4 py-2.5 text-[13px] placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 transition-colors"
            />
          </div>

          <button
            type="button"
            onClick={handleLoadModels}
            disabled={isLoadingModels || !activeKey.trim()}
            className="w-full rounded-xl border border-border/60 py-2.5 text-[13px] font-medium transition-all duration-150 hover:bg-muted/40 disabled:opacity-40"
          >
            {isLoadingModels ? "Loading models..." : "Load models"}
          </button>

          {modelsError ? (
            <p className="text-xs text-muted-foreground/80">{modelsError}</p>
          ) : null}

          {models.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground/70">Model from provider</label>
              <ModelSelector
                value={model}
                models={models}
                onChange={setModel}
                placeholder={`provider/model (e.g. ${resolveDefaultModelForProvider(provider)})`}
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground/70">Or enter custom model ID</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={resolveDefaultModelForProvider(provider)}
              className="w-full rounded-xl border border-border/60 bg-transparent px-4 py-2.5 text-[13px] placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={updateConfig.isPending || !model.trim()}
            className="w-full rounded-xl bg-foreground text-background py-2.5 text-[13px] font-medium hover:opacity-80 transition-all duration-150 disabled:opacity-40 mt-2"
          >
            {updateConfig.isPending ? "Setting up..." : "Get started"}
          </button>
        </form>
      </div>
    </div>
  );
}
