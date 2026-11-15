import { occurrenceId, type Meeting } from './model';

const MIN = 60_000;

/** A call joined up to this long before a meeting starts still belongs to it. */
export const EARLY_JOIN_MS = 10 * MIN;

/**
 * The meeting a call belongs to: one that was current when the call started (the latest started), or else one that
 * starts within 10 minutes after it (the earliest). Never a later one; none for an ad hoc call.
 */
export function pickCallMeeting(meetings: readonly Meeting[], since: number): Meeting | undefined {
  const near = meetings.filter((m) => Date.parse(m.start) <= since + EARLY_JOIN_MS && Date.parse(m.end) > since);
  const started = near.filter((m) => Date.parse(m.start) <= since).sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  if (started.length > 0) return started[0];
  return near.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
}

/** The call's meeting seen again in a newer list (same occurrence), or the kept copy when the list no longer has it. */
export function refreshCallMeeting(kept: Meeting, meetings: readonly Meeting[]): Meeting {
  const id = occurrenceId(kept);
  return meetings.find((m) => occurrenceId(m) === id) ?? kept;
}
