import { ORCHESTRATOR_AGENT_ID } from './agent-ids.js';

/** Platform-managed OpenBot (Fly + integrations proxy). Self-hosted when unset. */
export const isCloudMode = (): boolean => process.env.OPENBOT_CLOUD_MODE === '1';

/** Hardcoded provider/model for the cloud system agent. */
export const CLOUD_SYSTEM_MODEL = 'openai/gpt-5.4-nano';

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

export function assertCloudSystemAgentPluginsMutable(
  agentId: string,
  plugins: unknown,
): void {
  if (!isCloudMode() || agentId !== ORCHESTRATOR_AGENT_ID || plugins === undefined) return;
  throw new Error('System agent plugin configuration cannot be changed in cloud mode.');
}
