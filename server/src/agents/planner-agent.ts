import { MelonyPlugin } from "melony";
import { LanguageModel } from "ai";
import { llmPlugin } from "../plugins/llm/index.js";
import { ChatEvent, ChatState } from "../types.js";

export interface PlannerAgentOptions {
  model: LanguageModel;
}

const PLANNER_SYSTEM_PROMPT = `You are a planning specialist agent.

Your job:
- Convert a user intent into a short, executable plan.
- Keep plans practical and concise.
- Prefer 2-5 steps.
- Each step should specify the best agent to execute it when relevant.

Available agent naming convention:
- Use exact agent names when assigning (e.g. os, browser, topic, planner-agent, etc.).

Output format:
- Return strict JSON only.
- Shape:
{
  "goal": "...",
  "steps": [
    { "id": "step_1", "agent": "agent-name-or-manager", "task": "..." }
  ]
}

Rules:
- If no specialist agent is needed for a step, set "agent" to "manager".
- Do not include markdown fences.
- Do not include explanatory prose outside JSON.`;

export const plannerAgent = (options: PlannerAgentOptions): MelonyPlugin<ChatState, ChatEvent> => (builder) => {
  builder.use(llmPlugin({
    model: options.model,
    system: PLANNER_SYSTEM_PROMPT,
  }));
};
