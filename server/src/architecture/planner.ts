import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { AttachmentRef } from "../types.js";
import type { Intent, Plan, PlanStep } from "./contracts.js";

export interface PlannerInput {
  intent: Intent;
  content: string;
  attachments?: AttachmentRef[];
  knownAgents: string[];
}

export interface PlannerOptions {
  model?: LanguageModel;
}

function createStepId(index: number): string {
  return `step_${index + 1}`;
}

/**
 * Strategic planner that emits explicit executable steps.
 * Initial version is deterministic to keep behavior predictable.
 */
const PlanStepSchema = z.object({
  id: z.string(),
  kind: z.enum(["delegate", "manager"]),
  successCriteria: z.string(),
  agent: z.string().optional(),
  task: z.string().optional(),
  content: z.string().optional(),
});

const PlanSchema = z.object({
  goal: z.string(),
  stopCondition: z.string(),
  steps: z.array(PlanStepSchema).min(1).max(4),
});

function sanitizePlan(raw: z.infer<typeof PlanSchema>, input: PlannerInput): Plan {
  const steps: PlanStep[] = raw.steps.map((step, index) => {
    const normalized: PlanStep = {
      id: step.id?.trim() ? step.id : createStepId(index),
      kind: step.kind,
      successCriteria: step.successCriteria?.trim() || "Step completed successfully.",
    };

    if (step.kind === "delegate") {
      const chosenAgent =
        step.agent && input.knownAgents.includes(step.agent)
          ? step.agent
          : input.knownAgents[0];
      normalized.agent = chosenAgent;
      normalized.task = step.task?.trim() || input.content.trim();
    } else {
      normalized.content = step.content?.trim() || input.content.trim();
    }

    return normalized;
  });

  if (steps[0]) {
    steps[0].attachments = input.attachments;
  }

  return {
    goal: raw.goal?.trim() || input.content || "Handle user request",
    stopCondition:
      raw.stopCondition?.trim() || "All plan steps completed successfully.",
    steps,
  };
}

function buildDeterministicPlan(input: PlannerInput): Plan {
  const steps: PlanStep[] = [];
  const content = input.content.trim();
  const attachments = input.attachments;

  if (input.intent.type === "agent_direct" && input.intent.targetAgent) {
    const firstSpace = content.indexOf(" ");
    const delegatedTask =
      firstSpace === -1 ? "" : content.slice(firstSpace + 1).trim();

    steps.push({
      id: createStepId(0),
      kind: "delegate",
      agent: input.intent.targetAgent,
      task: delegatedTask,
      attachments,
      successCriteria: "Agent returns an output event.",
    });
  } else {
    steps.push({
      id: createStepId(0),
      kind: "manager",
      content,
      attachments,
      successCriteria: "Manager emits a completion message.",
    });
  }

  return {
    goal: content || "Handle user request",
    steps,
    stopCondition: "All plan steps completed successfully.",
  };
}

export async function createPlan(
  input: PlannerInput,
  options: PlannerOptions = {}
): Promise<Plan> {
  if (input.intent.type === "agent_direct") {
    return buildDeterministicPlan(input);
  }

  if (!options.model) {
    return buildDeterministicPlan(input);
  }

  try {
    const { object } = await generateObject({
      model: options.model,
      schema: PlanSchema,
      system: `You are a strategic planner for an AI orchestration system.
Output compact, executable plans.
Available agents: ${input.knownAgents.join(", ") || "none"}.
Use "delegate" only when an agent is clearly needed; otherwise use "manager".`,
      prompt: `Intent: ${JSON.stringify(input.intent)}
User request: ${input.content}
Return a plan with 1-4 steps.`,
    });

    return sanitizePlan(object, input);
  } catch {
    return buildDeterministicPlan(input);
  }
}
