/**
 * Channel `participants` (from `state.json`) scope which agents may collaborate
 * in that channel. Used for system-prompt hints and dispatch guards.
 */

/** Solo DM: exactly one participant and it is the acting agent (no peer bots). */
export function isDmSoloChannel(participants: string[], actingAgentId: string): boolean {
  return participants.length === 1 && participants[0] === actingAgentId;
}

/**
 * When `participants` is non-empty, todo dispatch targets must appear
 * in that list. Solo DM forbids targeting any agent other than yourself (for
 * chained steps); there are no peer bots.
 */
export function isParticipantDispatchAllowed(
  participants: string[],
  actingAgentId: string,
  targetAgentId: string,
): boolean {
  if (participants.length === 0) return true;
  if (!participants.includes(targetAgentId)) return false;
  if (isDmSoloChannel(participants, actingAgentId) && targetAgentId !== actingAgentId) {
    return false;
  }
  return true;
}
