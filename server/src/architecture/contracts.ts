import type { AttachmentRef } from "../types.js";

export type IntentType = "chat" | "task" | "agent_direct";

export interface Intent {
  type: IntentType;
  confidence: number;
  targetAgent?: string;
  constraints?: {
    requiresApproval?: boolean;
    maxSteps?: number;
  };
}

export type PlanStepKind = "delegate" | "manager";

export interface PlanStep {
  id: string;
  kind: PlanStepKind;
  successCriteria: string;
  agent?: string;
  task?: string;
  content?: string;
  attachments?: AttachmentRef[];
}

export interface Plan {
  goal: string;
  steps: PlanStep[];
  stopCondition: string;
}

export type ExecutionState =
  | "RECEIVED"
  | "CLASSIFIED"
  | "PLANNED"
  | "EXECUTING"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED";

export interface ExecutionTrace {
  traceId: string;
  state: ExecutionState;
  intent?: Intent;
  plan?: Plan;
  currentStepId?: string;
  error?: string;
  updatedAt: string;
}
