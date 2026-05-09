import { MelonyPlugin } from 'melony';
import { OpenBotEvent, OpenBotState } from '../app/types.js';
import { AgentDetails, ConfigSchema, Storage } from './types.js';

/**
 * Context passed into an AgentPackage factory at runtime.
 * Contains the resolved agent identity and the bus services available to it.
 */
export interface AgentPackageContext {
  agentId: string;
  agentDetails: AgentDetails;
  config: Record<string, unknown>;
  storage: Storage;
}

/**
 * An AgentPackage describes how to bring an agent online on the OpenBot bus.
 *
 * The bus does not know whether the underlying implementation uses Vercel AI SDK,
 * a Codex CLI, Claude Code, or a custom Python service. It only requires that the
 * package register handlers for the bus protocol it cares about (at minimum
 * `agent:invoke`, optionally `client:ui:widget:response`, etc.).
 */
export interface AgentPackage {
  id: string;
  name: string;
  description: string;
  image?: string;
  defaultInstructions?: string;
  configSchema?: ConfigSchema;
  /**
   * Build the Melony plugin that wires this agent onto the bus for one run.
   * Called fresh for each run so packages can capture per-run configuration.
   */
  factory: (context: AgentPackageContext) => MelonyPlugin<OpenBotState, OpenBotEvent>;
}
