import { ORCHESTRATOR_AGENT_ID } from './agent-ids.js';

/** Platform-managed OpenBot (Fly + integrations proxy). Self-hosted when unset. */
export const isCloudMode = (): boolean => process.env.OPENBOT_CLOUD_MODE === '1';

/** Platform-managed coordinator model for cloud workspaces. */
export const COORDINATOR_MODEL = 'openbot/coordinator-1';

/** Default cloud system agent model. */
export const CLOUD_SYSTEM_MODEL = COORDINATOR_MODEL;

export interface CloudIntegrationsConfig {
  baseUrl: string;
  token: string;
}

export function getCloudIntegrationsConfig(): CloudIntegrationsConfig | null {
  if (!isCloudMode()) return null;

  const baseUrl = process.env.OPENBOT_INTEGRATIONS_BASE_URL?.trim();
  const token = process.env.OPENBOT_INTEGRATIONS_TOKEN?.trim();
  if (!baseUrl || !token) return null;

  return { baseUrl: baseUrl.replace(/\/$/, ''), token };
}

export function isCloudSystemAgent(agentId: string): boolean {
  return isCloudMode() && agentId === ORCHESTRATOR_AGENT_ID;
}

export function resolveCloudSystemModel(configModel: string | undefined): string {
  return configModel?.trim() || COORDINATOR_MODEL;
}

export function assertCloudSystemAgentPluginsMutable(
  agentId: string,
  plugins: unknown,
): void {
  void agentId;
  void plugins;
}
