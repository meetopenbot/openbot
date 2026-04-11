/** Used by ChatView when flattening message content into timeline rows. */
export const TEXT_EVENT_TYPES = new Set([
  "agent:output",
  "agent:output-delta",
  "user:input",
  "agent:handoff",
  "agent:delegation",
]);
