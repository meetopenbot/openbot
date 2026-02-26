import type { Intent } from "./contracts.js";

export interface ClassifyInput {
  content: string;
  knownAgents: Set<string>;
}

/**
 * Classifies user input into a routing intent.
 * Starts with deterministic rules; can later be upgraded to hybrid LLM+rules.
 */
export function classifyIntent(input: ClassifyInput): Intent {
  const raw = input.content.trim();

  if (!raw) {
    return { type: "chat", confidence: 0.8 };
  }

  if (raw.startsWith("/") || raw.startsWith("@")) {
    const firstSpace = raw.indexOf(" ");
    const prefix = firstSpace === -1 ? raw.slice(1) : raw.slice(1, firstSpace);

    if (input.knownAgents.has(prefix)) {
      return {
        type: "agent_direct",
        confidence: 0.99,
        targetAgent: prefix,
      };
    }
  }

  const looksLikeTask =
    /\b(create|build|write|fix|update|implement|run|execute|open|edit|delete|list)\b/i.test(
      raw
    );

  if (looksLikeTask) {
    return { type: "task", confidence: 0.75 };
  }

  return { type: "chat", confidence: 0.7 };
}
