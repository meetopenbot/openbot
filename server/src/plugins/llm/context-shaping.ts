interface AttachmentRef {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface SimpleMessage {
  role: "system" | "user" | "assistant";
  content: string;
  attachments?: AttachmentRef[];
}

export interface ConversationContextState {
  currentGoal?: string;
  constraints?: string[];
  turnSummaries?: string[];
  rollingSummary?: string;
  updatedAt?: string;
}

export interface ContextShapingOptions {
  maxRecentRawMessages: number;
  maxRelevantMessages: number;
  maxContextChars: number;
  maxTurnSummaries: number;
  maxConstraints: number;
}

interface BuildContextInput {
  messages: SimpleMessage[];
  contextState?: ConversationContextState;
  options?: Partial<ContextShapingOptions>;
}

interface UpdateContextInput {
  contextState?: ConversationContextState;
  latestUserMessage: string;
  latestAssistantMessage: string;
}

const DEFAULT_OPTIONS: ContextShapingOptions = {
  maxRecentRawMessages: 4,
  maxRelevantMessages: 6,
  maxContextChars: 12_000,
  maxTurnSummaries: 20,
  maxConstraints: 8,
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "this",
  "from",
  "have",
  "your",
  "will",
  "would",
  "should",
  "could",
  "about",
  "what",
  "when",
  "where",
  "which",
  "into",
  "just",
  "like",
  "than",
  "then",
  "there",
  "their",
  "them",
  "also",
  "need",
  "want",
  "please",
]);

function mergeOptions(
  overrides?: Partial<ContextShapingOptions>
): ContextShapingOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...(overrides ?? {}),
  };
}

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

function toSearchText(message: SimpleMessage): string {
  return message.content.toLowerCase();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function overlapScore(messageText: string, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 0;
  let matched = 0;
  for (const term of queryTerms) {
    if (messageText.includes(term)) matched += 1;
  }
  return matched / queryTerms.length;
}

function recencyBoost(index: number, total: number): number {
  if (total <= 1) return 0;
  return index / (total - 1);
}

function estimateChars(messages: SimpleMessage[]): number {
  return messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
}

function buildContextBrief(
  state: ConversationContextState | undefined,
  maxChars: number
): string {
  if (!state) return "";

  const lines: string[] = [];
  if (state.currentGoal) lines.push(`Current objective: ${state.currentGoal}`);
  if (state.constraints && state.constraints.length > 0) {
    lines.push(`Constraints: ${state.constraints.join(" | ")}`);
  }
  if (state.rollingSummary) lines.push(`Recent summary: ${state.rollingSummary}`);

  if (lines.length === 0) return "";

  return clip(
    `System context for this turn:\n${lines.map((line) => `- ${line}`).join("\n")}`,
    maxChars
  );
}

export function buildShapedContext(
  input: BuildContextInput
): SimpleMessage[] {
  const options = mergeOptions(input.options);
  const messages = input.messages;

  if (messages.length <= options.maxRecentRawMessages) {
    const brief = buildContextBrief(input.contextState, 1_500);
    return brief
      ? [{ role: "user", content: brief }, ...messages]
      : messages;
  }

  const recentStart = Math.max(0, messages.length - options.maxRecentRawMessages);
  const recent = messages.slice(recentStart);
  const older = messages.slice(0, recentStart);

  const latestUser = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const queryTerms = latestUser ? tokenize(latestUser.content) : [];

  const scored = older
    .map((message, index) => {
      const text = toSearchText(message);
      const relevance = overlapScore(text, queryTerms);
      const score = relevance * 0.8 + recencyBoost(index, older.length) * 0.2;
      return { index, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.maxRelevantMessages)
    .sort((a, b) => a.index - b.index);

  const selectedOlder = scored.map((row) => older[row.index]);
  const brief = buildContextBrief(input.contextState, 1_500);

  let selected: SimpleMessage[] = [
    ...(brief ? [{ role: "user", content: brief } as SimpleMessage] : []),
    ...selectedOlder,
    ...recent,
  ];

  while (estimateChars(selected) > options.maxContextChars) {
    const removableIndex = selected.findIndex((message, index) => {
      if (brief && index === 0) return false;
      return index < selected.length - options.maxRecentRawMessages;
    });
    if (removableIndex === -1) break;
    selected.splice(removableIndex, 1);
  }

  return selected;
}

function extractConstraints(
  text: string,
  existing: string[],
  maxConstraints: number
): string[] {
  const hasConstraintLanguage = /\b(do not|don't|must|never|always|only)\b/i.test(text);
  if (!hasConstraintLanguage) return existing;
  const normalized = clip(text.trim().replace(/\s+/g, " "), 180);
  if (!normalized) return existing;
  if (existing.includes(normalized)) return existing;
  const next = [...existing, normalized];
  return next.slice(-maxConstraints);
}

export function updateContextState(
  input: UpdateContextInput,
  optionsOverride?: Partial<ContextShapingOptions>
): ConversationContextState {
  const options = mergeOptions(optionsOverride);
  const existing = input.contextState ?? {};
  const constraints = extractConstraints(
    input.latestUserMessage,
    existing.constraints ?? [],
    options.maxConstraints
  );

  const compactUser = clip(input.latestUserMessage.trim().replace(/\s+/g, " "), 200);
  const compactAssistant = clip(
    input.latestAssistantMessage.trim().replace(/\s+/g, " "),
    240
  );
  const turnSummary = compactUser || compactAssistant
    ? `U: ${compactUser || "-"} | A: ${compactAssistant || "-"}`
    : "";

  const turnSummaries = turnSummary
    ? [...(existing.turnSummaries ?? []), turnSummary].slice(-options.maxTurnSummaries)
    : existing.turnSummaries ?? [];

  const rollingSummary = turnSummaries.slice(-6).join(" || ");
  const latestUserMessage = input.latestUserMessage.trim();
  const isToolEcho = latestUserMessage.startsWith("System: Action ");
  const currentGoal = !isToolEcho && latestUserMessage
    ? clip(latestUserMessage, 240)
    : existing.currentGoal;

  return {
    currentGoal,
    constraints,
    turnSummaries,
    rollingSummary,
    updatedAt: new Date().toISOString(),
  };
}
