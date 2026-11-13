export type AccountState = 'ok' | 'signed-out' | 'needs-sign-in' | 'unavailable' | 'checking';

export interface MeetAccount {
  id: string;
  label: string;
  state: AccountState;
  /** Why the account is not connected: a short fixed-shape code such as `graph-403-ErrorAccessDenied`. */
  reason?: string;
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
  /** Settle order on the native side: an answer with a lower number is older. */
  seq?: number;
}

export const NOT_CONFIGURED = 'not-configured';
export const INVALID_CONFIG = 'invalid-config';

export const REFRESH_MS = 5 * 60_000;
/** After an unavailable read: retry after 30 s, then 60 s, then the normal cadence. */
export const FAST_RETRY_MS: readonly number[] = [30_000, 60_000];
export const TICK_MS = 30_000;
/** Meet leaves "Loading meetings", and each account leaves "Checking", after at most this long. */
export const READ_LIMIT_MS = 12_000;
/** The reason the web view gives an account that did not answer in time. */
export const TIMED_OUT = 'graph-timeout';

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
  if (state === 'checking') return 'Checking';
  if (state === 'unavailable') return 'Unavailable';
  if (state === 'signed-out') return 'Signed out';
  return 'Sign in again';
}

/** What is wrong with an unavailable account, in plain words. */
export function unavailableWords(reason: string | undefined | null): string {
  if (reason === 'graph-network' || reason === 'token-network') return 'Network problem';
  if (reason === TIMED_OUT) return 'Microsoft is not answering';
  const m = reason ? /^(?:graph|token)-([0-9]{3})/.exec(reason) : null;
  if (m) {
    const status = Number(m[1]);
    if (status === 429 || status >= 500) return 'Microsoft is not answering';
  }
  if (reason?.startsWith('store-')) return 'Could not use the saved sign-in on this PC';
  return 'Calendar could not be read';
}

/** The account row's one line of state. */
export function accountWords(state: AccountState, reason: string | undefined | null): string {
  return state === 'unavailable' ? unavailableWords(reason) : statusWord(state);
}

/** True when no account could be read: at least one account, none connected, none still being asked. */
export function calendarNotAvailable(accounts: readonly { state: AccountState }[]): boolean {
  return accounts.length > 0 && accounts.every((a) => a.state !== 'ok' && a.state !== 'checking');
}

const REASON_SHAPE = /^(?:graph-[0-9]{3}(?:-[A-Za-z][A-Za-z0-9_]{0,39})?|token-[0-9]{3}(?:-[0-9]{1,7})?|graph-network|graph-timeout|graph-body|token-network|store-write|store-read)$/;

/** Plain words for a reason code, or null when the code is not one of the known shapes. */
export function reasonText(code: string | undefined | null): string | null {
  if (!code || !REASON_SHAPE.test(code)) return null;
  if (code.startsWith('store-')) return 'Could not save the sign-in on this PC';
  if (code === 'graph-network' || code === 'token-network') return 'No connection to Microsoft';
  if (code === 'graph-timeout') return 'Microsoft did not answer in time';
  if (code === 'graph-body') return 'Calendar sent a reply that could not be read';
  if (code.startsWith('token-')) return 'Sign-in was not accepted';
  const status = Number(code.slice(6, 9));
  if (status === 403) return 'Calendar refused the request';
  if (status === 400) return 'Calendar did not understand the request';
  if (status === 429 || status >= 500) return 'Calendar is busy, trying again';
  if (status === 401) return 'Calendar did not accept the sign-in';
  return 'Calendar could not be read';
}

/** The quiet line under Unavailable: the words, then the code in brackets. Null when unknown. */
export function reasonLine(code: string | undefined | null): string | null {
  const words = reasonText(code);
  return words ? `${words} (${code})` : null;
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
      return reasonLine(error) ?? 'Sign-in did not work';
  }
}
