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
  lastEventId?: string;
  lastEventAt?: number;
  lastReadAt?: number;
  unread?: boolean;
  participatingAgents?: string[];
}

export interface ChannelInfo {
  id: string;
  title: string;
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
  runtime?: string | { name: string; config?: unknown };
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

export interface ConversationsActivityResponse {
  byConversation: Record<string, { active: boolean; agents: string[] }>;
}

/** Send this as `value` for a secret row the user did not change (must match server). */
export const USER_VARIABLE_SECRET_UNCHANGED = "••••••••••••••••";

export interface UserVariablePublic {
  key: string;
  secret: boolean;
  hasValue: boolean;
  value?: string;
}

export interface UserVariablesResponse {
  variables: UserVariablePublic[];
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

  getUserProfile: () => request<{ profile: string }>("/api/user/profile"),

  updateUserProfile: (profile: string) =>
    request<{ success: boolean }>("/api/user/profile", {
      method: "PUT",
      body: JSON.stringify({ profile }),
    }),

  getVariables: () => request<UserVariablesResponse>("/api/variables"),

  updateVariables: (variables: Array<{ key: string; secret: boolean; value: string }>) =>
    request<{ success: boolean }>("/api/variables", {
      method: "PUT",
      body: JSON.stringify({ variables }),
    }),

  getConversations: () => request<ConversationInfo[]>("/api/conversations"),
  markConversationRead: (id: string) =>
    request<{ success: boolean; conversationId: string; lastReadEventId?: string; lastReadAt?: number }>(
      `/api/conversations/${encodeURIComponent(id)}/read`,
      { method: "POST" },
    ),
  getConversationsActivity: () =>
    request<ConversationsActivityResponse>("/api/conversations/activity"),

  createChannel: (name: string) =>
    request<{ success: boolean; channel: ChannelInfo }>("/api/channels", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  deleteChannel: (id: string) =>
    request<{ success: boolean }>(`/api/channels/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  getChannelSpec: (id: string) =>
    request<{ spec: string }>(`/api/channels/${encodeURIComponent(id)}/spec`),

  updateChannelSpec: (id: string, spec: string) =>
    request<{ success: boolean }>(`/api/channels/${encodeURIComponent(id)}/spec`, {
      method: "PUT",
      body: JSON.stringify({ spec }),
    }),

  getConversationState: (id: string) =>
    request<any>(`/api/conversations/${encodeURIComponent(id)}/state`),

  getConversationEvents: (id: string) => request<any[]>(`/api/conversations/${encodeURIComponent(id)}/events`),
  getConversationEventsRaw: async (id: string) => {
    const res = await fetch(`${BASE_URL}/api/conversations/${encodeURIComponent(id)}/events/raw`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.text();
  },
  getConversationStreamUrl: (id: string, afterId?: string) => {
    const base = `${BASE_URL}/api/conversations/${encodeURIComponent(id)}/stream`;
    if (!afterId) return base;
    return `${base}?afterId=${encodeURIComponent(afterId)}`;
  },
  createRun: (
    conversationId: string,
    event: any,
    options?: { runId?: string },
  ) =>
    request<{ runId: string }>('/api/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-openbot-conversation-id': conversationId,
        ...(options?.runId ? { 'x-openbot-run-id': options.runId } : {}),
      },
      body: JSON.stringify(event),
    }),
  cancelRun: (runId: string) =>
    request<{ success: boolean }>(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
    }),

  postMessageReaction: (
    conversationId: string,
    payload: { targetMessageId: string; reaction: "like" | "dislike" | "none" },
  ) =>
    request<{ success: boolean }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/reactions`,
      { method: "POST", body: JSON.stringify(payload) },
    ),

  getAgents: () =>
    request<
      {
        id: string;
        name: string;
        description: string;
        folder?: string;
        isDefault?: boolean;
        isBuiltIn?: boolean;
        hasAgentMd?: boolean;
        image?: string;
        type?: string;
      }[]
    >("/api/agents"),

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
