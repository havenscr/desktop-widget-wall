import { sessionsOn, type FocusSession } from '../../focus/day';
import { occurrenceId, type Meeting } from '../../meet/model';
import { waitingIds, type OmniSummary } from '../../agents/model';

const MIN = 60_000;

/** Whole minutes of focus so far today (sessions clipped to the local day, an open one counted up to `now`). */
export function focusToday(sessions: readonly FocusSession[], now: number): number {
  let ms = 0;
  for (const s of sessionsOn(sessions, now)) ms += Math.max(0, Math.min(s.end, now) - s.start);
  return Math.floor(ms / MIN);
}

/** "3 h 10 m", "45 m", "0 m". */
export function durationText(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${m} m`;
}

/** Meetings still ahead today, not counting `skip` (the one the band is already showing). */
export function meetingsLeft(meetings: readonly Meeting[], now: number, skip?: Meeting): number {
  const day = new Date(now);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  return meetings.filter((m) => Date.parse(m.start) > now && Date.parse(m.start) < end && !(skip && occurrenceId(m) === occurrenceId(skip))).length;
}

/** Agent sessions waiting on the owner, minus the ones snoozed here; 0 with no summary. */
export function waitingCount(summary: OmniSummary | null, snoozed: ReadonlySet<string> = new Set()): number {
  return summary ? waitingIds(summary).filter((id) => !snoozed.has(id)).length : 0;
}
