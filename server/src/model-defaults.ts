export const DEFAULT_MODEL_ID = "openai/gpt-5-nano";

export const DEFAULT_MODEL_BY_PROVIDER = {
  openai: DEFAULT_MODEL_ID,
  anthropic: "anthropic/claude-sonnet-4-5-20250929",
} as const;

export interface ModelCatalogFallbackItem {
  id: string;
  label: string;
}

export const FALLBACK_MODELS: ModelCatalogFallbackItem[] = [
  { id: "openai/gpt-5.2", label: "OpenAI GPT-5.2" },
  { id: "openai/gpt-5.2-chat-latest", label: "OpenAI GPT-5.2 Chat Latest" },
  { id: "openai/gpt-5.2-pro", label: "OpenAI GPT-5.2 Pro" },
  { id: "openai/gpt-5", label: "OpenAI GPT-5" },
  { id: "openai/gpt-5-mini", label: "OpenAI GPT-5 Mini" },
  { id: "openai/gpt-5-nano", label: "OpenAI GPT-5 Nano" },
  { id: "openai/gpt-4.1", label: "OpenAI GPT-4.1" },
  { id: "openai/gpt-4.1-mini", label: "OpenAI GPT-4.1 Mini" },
  { id: "openai/gpt-4o", label: "OpenAI GPT-4o" },
  { id: "openai/gpt-4o-mini", label: "OpenAI GPT-4o Mini" },
  { id: "openai/o4-mini", label: "OpenAI o4-mini" },
  { id: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "anthropic/claude-opus-4-5-20251101", label: "Claude Opus 4.5" },
  { id: "anthropic/claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { id: "anthropic/claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet" },
  { id: "anthropic/claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
  { id: "anthropic/claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" },
];
