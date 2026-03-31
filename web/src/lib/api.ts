const BASE_URL = (window as any).MELONY_BASE_URL || "http://localhost:4001";

export { BASE_URL };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json() as { error?: string };
      detail = body.error ? `: ${body.error}` : "";
    } catch {
      // ignore parse errors for non-json responses
    }
    throw new Error(`API error: ${res.status}${detail}`);
  }
  return res.json();
}

export interface ConversationInfo {
  id: string;
  kind: "dm" | "channel";
  title?: string;
  agentId?: string;
  mtime: string;
}

export interface ChannelInfo {
  id: string;
  title: string;
}

export interface ChannelMember {
  id: string;
  name: string;
}

export interface ChannelMembersState {
  conversationId: string;
  managerId: string;
  members: ChannelMember[];
}

export interface AppConfig {
  configured: boolean;
  name: string;
  description: string;
  model: string;
  image?: string;
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
  image?: string;
  plugins: Array<string | AgentPluginConfig>;
  subscribe?: string[];
}

export interface CreateAgentPayload extends AgentConfig {
  id: string;
  md?: string;
}

export type ModelProvider = "openai" | "anthropic";

export interface AutomationItem {
  id: string;
  name: string;
  prompt: string;
  cron: string;
  targetType: "orchestrator" | "agent";
  agentName?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InstalledPluginInfo {
  id: string;
  name: string;
  description: string;
  folder: string;
  type: "tool" | "agent";
  hasAgentMd: boolean;
  image?: string;
}

export interface MarketplaceItem {
  id: string;
  name: string;
  description: string;
  source: {
    type: "github" | "npm";
    value: string;
  };
  tags?: string[];
  image?: string;
}

export const api = {
  getConfig: () => request<AppConfig>("/api/config"),

  updateConfig: (data: {
    name?: string;
    description?: string;
    model?: string;
    image?: string;
    openai_api_key?: string;
    anthropic_api_key?: string;
  }) => request<{ success: boolean }>("/api/config", { method: "POST", body: JSON.stringify(data) }),

  getConversations: () => request<ConversationInfo[]>("/api/conversations"),

  createChannel: (name: string) =>
    request<{ success: boolean; channel: ChannelInfo }>("/api/channels", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  deleteChannel: (id: string) =>
    request<{ success: boolean }>(`/api/channels/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  getChannelMembers: (id: string) =>
    request<ChannelMembersState>(`/api/channels/${encodeURIComponent(id)}/members`),

  addChannelMember: (id: string, payload: { memberId: string; name: string }) =>
    request<ChannelMembersState>(`/api/channels/${encodeURIComponent(id)}/members`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  removeChannelMember: (id: string, memberId: string) =>
    request<ChannelMembersState>(
      `/api/channels/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`,
      { method: "DELETE" },
    ),

  setChannelManager: (id: string, managerId: string) =>
    request<ChannelMembersState>(`/api/channels/${encodeURIComponent(id)}/manager`, {
      method: "PUT",
      body: JSON.stringify({ managerId }),
    }),

  getConversationEvents: (id: string) => request<any[]>(`/api/conversations/${encodeURIComponent(id)}/events`),

  getAgents: () =>
    request<{ id: string; name: string; description: string; folder: string; isDefault?: boolean; hasAgentMd?: boolean; image?: string }[]>("/api/agents"),

  createAgent: (data: CreateAgentPayload) =>
    request<{ success: boolean; id: string }>("/api/agents", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getInstalledPlugins: () =>
    request<InstalledPluginInfo[]>("/api/plugins"),

  getRegistryPlugins: () =>
    request<{ name: string; description: string; isBuiltIn?: boolean }[]>("/api/registry/plugins"),

  getPrompts: () =>
    request<{ label: string; icon: string }[]>("/api/prompts"),

  getAutomations: () =>
    request<AutomationItem[]>("/api/automations"),

  createAutomation: (data: {
    name: string;
    prompt: string;
    cron: string;
    targetType: "orchestrator" | "agent";
    agentName?: string;
  }) =>
    request<AutomationItem>("/api/automations", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateAutomation: (
    id: string,
    data: Partial<Pick<AutomationItem, "name" | "prompt" | "cron" | "enabled" | "targetType" | "agentName">>
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

  getAgentMd: async (agentId: string) => {
    const res = await fetch(`${BASE_URL}/api/agents/${encodeURIComponent(agentId)}/md`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.text();
  },

  updateAgentMd: (agentId: string, md: string) =>
    request<{ success: boolean }>(`/api/agents/${encodeURIComponent(agentId)}/md`, {
      method: "PUT",
      body: JSON.stringify({ md }),
    }),

  getAgentConfig: (agentId: string) =>
    request<AgentConfig>(`/api/agents/${encodeURIComponent(agentId)}/config`),

  updateAgentConfig: (agentId: string, config: AgentConfig) =>
    request<{ success: boolean }>(`/api/agents/${encodeURIComponent(agentId)}/config`, {
      method: "PUT",
      body: JSON.stringify(config),
    }),

  getMarketplaceAgents: () =>
    request<MarketplaceItem[]>("/api/marketplace/agents"),

  getMarketplacePlugins: () =>
    request<MarketplaceItem[]>("/api/marketplace/plugins"),

  installMarketplaceAgent: (id: string) =>
    request<{ success: boolean; installedName: string; item: MarketplaceItem }>("/api/marketplace/install-agent", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),

  installMarketplacePlugin: (id: string) =>
    request<{ success: boolean; installedName: string; item: MarketplaceItem }>("/api/marketplace/install-plugin", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),

  openFolder: (folder: string) =>
    request<{ success: boolean }>("/api/actions/open-folder", {
      method: "POST",
      body: JSON.stringify({ folder }),
    }),

  reload: () =>
    request<{ success: boolean }>("/api/actions/reload", { method: "POST" }),

  uploadImage: (data: { name: string; mimeType: string; dataBase64: string }) =>
    request<AttachmentRef>("/api/uploads/image", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getVersion: () =>
    request<{ current: string; latest: string; updateAvailable: boolean }>("/api/version"),
};
