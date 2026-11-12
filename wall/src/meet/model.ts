export type AccountState = 'ok' | 'signed-out' | 'needs-sign-in' | 'unavailable';

export interface MeetAccount {
  id: string;
  label: string;
  state: AccountState;
}

export interface Meeting {
  /** Opaque key; the native side holds the join link behind it. */
  key: string;
  accountId: string;
  title: string;
  /** UTC, `2026-11-12T17:00:00Z`. */
  start: string;
  end: string;
  canJoin: boolean;
}

export interface MeetData {
  accounts: MeetAccount[];
  meetings: Meeting[];
  /** True when part of the list is from an earlier read because an account was unavailable. */
  stale?: boolean;
}

export const NOT_CONFIGURED = 'not-configured';
export const INVALID_CONFIG = 'invalid-config';

export const REFRESH_MS = 5 * 60_000;
export const TICK_MS = 30_000;

const MIN = 60_000;

/** The first meeting that has not ended yet (the list arrives sorted by start). */
export function nextMeeting(meetings: readonly Meeting[], now: number): Meeting | undefined {
  return meetings.find((m) => Date.parse(m.end) > now);
}

/** Meetings after the next one that have not ended. */
export function laterMeetings(meetings: readonly Meeting[], now: number): Meeting[] {
  const live = meetings.filter((m) => Date.parse(m.end) > now);
  return live.slice(1);
}

/** 3 PM, or 3:30 PM, in local time. */
export function clockText(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

export function timeRange(m: Pick<Meeting, 'start' | 'end'>): string {
  return `${clockText(Date.parse(m.start))} to ${clockText(Date.parse(m.end))}`;
}

/**
 * "Now, 12 min left", "In 3 min", "In 42 min", "In 1 h 05 min", "At 3:30 PM" (more than
 * three hours away), or "Nothing in the next 24 hours".
 */
export function countdownText(m: Pick<Meeting, 'start' | 'end'> | undefined, now: number): string {
  if (!m) return 'Nothing in the next 24 hours';
  const start = Date.parse(m.start);
  const end = Date.parse(m.end);
  if (start <= now) {
    return `Now, ${Math.max(1, Math.ceil((end - now) / MIN))} min left`;
  }
  const mins = Math.ceil((start - now) / MIN);
  if (mins > 180) return `At ${clockText(start)}`;
  if (mins < 60) return `In ${mins} min`;
  return `In ${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
}

/** True when the next meeting starts within five minutes (and has not started). */
export function isSoon(m: Pick<Meeting, 'start'> | undefined, now: number): boolean {
  if (!m) return false;
  const start = Date.parse(m.start);
  return start > now && start - now <= 5 * MIN;
}

export function statusWord(state: AccountState): string {
  if (state === 'ok') return 'Connected';
  if (state === 'unavailable') return 'Unavailable';
  return 'Sign in needed';
}

export function needsSignIn(state: AccountState): boolean {
  return state === 'signed-out' || state === 'needs-sign-in';
}

/** Short text for a sign-in that did not finish; null when there is nothing to say. */
export function signInMessage(error: string): string | null {
  switch (error) {
    case 'cancelled':
      return null;
    case 'denied':
      return 'Sign-in was declined';
    case 'timed-out':
      return 'Sign-in timed out';
    case 'busy':
      return 'A sign-in is already open';
    case NOT_CONFIGURED:
      return 'Not set up';
    default:
      return 'Sign-in did not work';
  }
}
