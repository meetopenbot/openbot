const BASE_URL = (window as any).MELONY_BASE_URL || "http://localhost:4001";

export { BASE_URL };

export interface EventResponse {
  results: any[];
}

async function sendEvent<T = any>(
  event: any,
  meta?: { 
    conversationId?: string; 
    runId?: string; 
    agentId?: string; 
    responseType?: 'stream' | 'json' 
  }
): Promise<T> {
  const responseType = meta?.responseType || 'json';
  const res = await fetch(`${BASE_URL}/api/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(meta?.conversationId ? { 'x-openbot-conversation-id': meta.conversationId } : {}),
      ...(meta?.runId ? { 'x-openbot-run-id': meta.runId } : {}),
      ...(meta?.agentId ? { 'x-openbot-agent-id': meta.agentId } : {}),
      'x-openbot-response-type': responseType,
    },
    body: JSON.stringify(event),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json() as { error?: string };
      detail = body.error ? `: ${body.error}` : "";
    } catch {
      // ignore
    }
    throw new Error(`API error: ${res.status}${detail}`);
  }

  if (responseType === 'stream') {
    return res as any; // Return the response object for streaming
  }

  const { results } = await res.json() as EventResponse;
  // For JSON requests, we usually want the data from the last event or a specific result event
  const lastEvent = results[results.length - 1];
  return (lastEvent?.data ?? lastEvent) as T;
}

// Helper for simple JSON events
async function request<T>(type: string, data?: any, meta?: any): Promise<T> {
  return sendEvent<T>({ type, data }, { ...meta, responseType: 'json' });
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

export interface UserVariablePublic {
  key: string;
  secret: boolean;
  hasValue: boolean;
  value?: string;
}

export interface PromptSuggestion {
  label: string;
  icon?: string;
}

/** Send this as `value` for a secret row the user did not change (must match server). */
export const USER_VARIABLE_SECRET_UNCHANGED = "••••••••••••••••";

export const api = {
  // Config
  getConfig: () => request<AppConfig>("config:get"),
  updateConfig: (data: any) => request<{ success: boolean }>("config:update", data),

  // User
  getUserProfile: () => request<{ profile: string }>("user:get-profile"),
  updateUserProfile: (profile: string) => request<{ success: boolean }>("user:update-profile", { profile }),
  getVariables: () => request<{ variables: UserVariablePublic[] }>("variables:list"),
  updateVariables: (variables: any[]) => request<{ success: boolean }>("variables:update", { variables }),

  // Conversations & Channels
  getConversations: () => request<ConversationInfo[]>("conversations:list"),
  getChannels: () => request<ConversationInfo[]>("channels:list"),
  getConversationsActivity: () => request<{ byConversation: Record<string, { active: boolean; agents: string[] }> }>("conversations:get-activity"),
  createChannel: (name: string) => request<ChannelInfo>("channels:create", { name }),
  deleteChannel: (conversationId: string) => request<{ success: boolean }>("channels:delete", { conversationId }),
  getChannelSpec: (conversationId: string) => request<{ spec: string }>("channels:get-spec", { conversationId }),
  updateChannelSpec: (conversationId: string, spec: string) => request<{ success: boolean }>("channels:update-spec", { conversationId, spec }),
  
  // Conversation State & Events
  getConversationState: (conversationId: string) => request<any>("conversations:get-state", { conversationId }),
  getConversationEvents: (conversationId: string) => request<any[]>("conversations:get-events", { conversationId }),
  markConversationRead: (conversationId: string) => request<{ success: boolean }>("conversations:mark-read", { conversationId }),
  
  // Agents
  getAgents: () => request<any[]>("agents:list"),
  getAgentConfig: (agentId: string) => request<AgentConfig>("agents:get-config", { agentId }),
  updateAgentConfig: (agentId: string, config: AgentConfig) => request<{ success: boolean }>("agents:update-config", { agentId, config }),
  getAgentMd: (agentId: string) => request<{ md: string }>("agents:get-md", { agentId }).then(r => r.md),
  updateAgentMd: (agentId: string, md: string) => request<{ success: boolean }>("agents:update-md", { agentId, md }),

  // Marketplace
  getMarketplacePlugins: () => request<MarketplaceItem[]>("marketplace:list"),
  installMarketplacePlugin: (id: string) => request<{ success: boolean; installedName: string; item: MarketplaceItem }>("marketplace:install", { id }),

  // Plugins
  getInstalledPlugins: () => request<InstalledPluginInfo[]>("plugins:list"),
  getRegistryPlugins: () => request<{ name: string; description: string; isBuiltIn?: boolean }[]>("plugins:registry-list"),

  // Automations
  getAutomations: () => request<AutomationItem[]>("automations:list"),
  createAutomation: (data: any) => request<AutomationItem>("automations:create", data),
  updateAutomation: (id: string, data: any) => request<AutomationItem>("automations:update", { id, ...data }),
  deleteAutomation: (id: string) => request<{ success: boolean }>("automations:delete", { id }),

  // Starter prompts (empty-state suggestions)
  getPrompts: () => request<PromptSuggestion[]>("prompts:list"),

  // Models
  getModels: () => request<ModelOption[]>("models:list"),
  previewModels: (data: { provider: ModelProvider; apiKey: string }) => request<ModelOption[]>("models:preview", data),

  // Uploads
  uploadImage: (data: { name: string; mimeType: string; dataBase64: string }) => 
    request<any>("uploads:image", data),

  // Actions
  openFolder: (folder: string) => request<{ success: boolean }>("actions:open-folder", { folder }),
  reload: () => request<{ success: boolean }>("actions:reload"),
  getVersion: () => request<{ current: string; latest: string; updateAvailable: boolean }>("version:get"),

  // Runs & Events
  sendEventStream: (conversationId: string, event: any, options?: { runId?: string; agentId?: string }) => 
    sendEvent(event, { conversationId, ...options, responseType: 'stream' }),
  
  sendEventJson: (conversationId: string, event: any, options?: { runId?: string; agentId?: string }) => 
    sendEvent(event, { conversationId, ...options, responseType: 'json' }),

  // Legacy/Compatibility if needed (but refactored to use events)
  createRun: (conversationId: string, event: any, options?: { runId?: string }) =>
    sendEvent(event, { conversationId, runId: options?.runId, responseType: 'json' }),
    
  cancelRun: (runId: string) => request<{ success: boolean }>("run:cancel", { runId }),
  
  postMessageReaction: (conversationId: string, data: any) => 
    request<{ success: boolean }>("message:reaction", data, { conversationId }),
};
