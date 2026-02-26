const BASE_URL = (window as any).MELONY_BASE_URL || "http://localhost:4001";

export { BASE_URL };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface SessionInfo {
  id: string;
  title?: string;
  mtime: string;
  execution?: {
    traceId?: string;
    state?: string;
    currentStepId?: string;
    error?: string;
    updatedAt?: string;
  };
}

export interface AppConfig {
  configured: boolean;
  model: string;
  defaultModelId: string;
  defaultModels: Record<ModelProvider, string>;
  hasOpenAIKey: boolean;
  hasAnthropicKey: boolean;
}

export interface AttachmentRef {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface AgentPluginConfig {
  name: string;
  config?: unknown;
}

export interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  plugins: Array<string | AgentPluginConfig>;
  systemPrompt: string;
  subscribe?: string[];
}

export type ModelProvider = "openai" | "anthropic";

export interface AutomationItem {
  id: string;
  name: string;
  prompt: string;
  cron: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export const api = {
  getConfig: () => request<AppConfig>("/api/config"),

  updateConfig: (data: {
    model?: string;
    openai_api_key?: string;
    anthropic_api_key?: string;
  }) => request<{ success: boolean }>("/api/config", { method: "POST", body: JSON.stringify(data) }),

  getSessions: () => request<SessionInfo[]>("/api/sessions"),

  getSessionEvents: (id: string) => request<any[]>(`/api/sessions/${encodeURIComponent(id)}/events`),

  getAgents: () =>
    request<{ name: string; description: string; folder: string }[]>("/api/agents"),

  getPrompts: () =>
    request<{ label: string; icon: string }[]>("/api/prompts"),

  getAutomations: () =>
    request<AutomationItem[]>("/api/automations"),

  createAutomation: (data: { name: string; prompt: string; cron: string }) =>
    request<AutomationItem>("/api/automations", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateAutomation: (
    id: string,
    data: Partial<Pick<AutomationItem, "name" | "prompt" | "cron" | "enabled">>
  ) =>
    request<AutomationItem>(`/api/automations/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteAutomation: (id: string) =>
    request<{ success: boolean }>(`/api/automations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
 
  getModels: () =>
    request<ModelOption[]>("/api/models"),

  previewModels: (data: { provider: ModelProvider; apiKey: string }) =>
    request<ModelOption[]>("/api/models/preview", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getAgentYaml: async (name: string) => {
    const res = await fetch(`${BASE_URL}/api/agents/${encodeURIComponent(name)}/yaml`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.text();
  },

  getAgentConfig: (name: string) =>
    request<AgentConfig>(`/api/agents/${encodeURIComponent(name)}/config`),

  updateAgentConfig: (name: string, config: AgentConfig) =>
    request<{ success: boolean }>(`/api/agents/${encodeURIComponent(name)}/config`, {
      method: "PUT",
      body: JSON.stringify(config),
    }),

  updateAgentYaml: (name: string, yaml: string) =>
    request<{ success: boolean }>(`/api/agents/${encodeURIComponent(name)}/yaml`, {
      method: "PUT",
      body: JSON.stringify({ yaml }),
    }),

  openFolder: (folder: string) =>
    request<{ success: boolean }>("/api/actions/open-folder", {
      method: "POST",
      body: JSON.stringify({ folder }),
    }),

  uploadImage: (data: { name: string; mimeType: string; dataBase64: string }) =>
    request<AttachmentRef>("/api/uploads/image", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
