/**
 * The calendar meeting a call belongs to, for the Presenting page. Pure. The page does not guess from
 * the title: a call belongs to the meeting whose window (ten minutes before its start, to its end)
 * holds the moment the call began. Only an item that can be joined counts, and an entry of 24 hours or
 * more (an all-day block) never does.
 */
import type { Meeting } from '../meet/model';

const MIN = 60_000;

/** A call that began up to this long before a meeting starts still belongs to it. */
export const MATCH_EARLY_MS = 10 * MIN;

/** An entry this long or longer is an all-day or multi-day block, never a meeting a call belongs to. */
export const MATCH_MAX_MS = 24 * 60 * MIN;

/**
 * `meetings` is the shared feed's list, or an empty one when the feed is stale or failed (a stale list
 * must not claim a match). With two meetings in the window, the one that starts later wins; none gives
 * null (the unmatched page).
 */
export function matchMeeting(meetings: readonly Meeting[], since: number, feedUsable = true): Meeting | null {
  if (!feedUsable) return null;
  let best: Meeting | null = null;
  for (const m of meetings) {
    const start = Date.parse(m.start);
    const end = Date.parse(m.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (!m.canJoin || end - start >= MATCH_MAX_MS) continue;
    if (start - MATCH_EARLY_MS <= since && since <= end) {
      if (best === null || start > Date.parse(best.start)) best = m;
    }
  }
  return best;
}

/** When the talk timer starts: the later of the meeting's start and the call's start; the call's start when unmatched. */
export function talkStart(meeting: Meeting | null, since: number): number {
  return meeting ? Math.max(Date.parse(meeting.start), since) : since;
}

/** Whole minutes left by the calendar, rounded up; negative or zero past the end. Null when unmatched. */
export function minutesLeft(meeting: Meeting | null, now: number): number | null {
  if (!meeting) return null;
  const left = Date.parse(meeting.end) - now;
  return left <= 0 ? 0 : Math.ceil(left / MIN);
}
