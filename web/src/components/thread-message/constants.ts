/** Used by ThreadView when flattening message content into timeline rows. */
export const TEXT_EVENT_TYPES = new Set([
  "agent:output",
  "agent:output-delta",
  "agent:input",
]);

export const DELEGATION_EVENT_TYPES = new Set([
  "delegation:start",
  "delegation:end",
]);
