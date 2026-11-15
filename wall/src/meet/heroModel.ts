import type { CallKind, CallSignal, LeaveSignal } from '../signals/model';
import { clockText, type Meeting, type MeetingDetails, type Person } from './model';

const MIN = 60_000;

/** A title over this many characters drops to a smaller size on three lines. */
export const LONG_TITLE = 50;

/** The word for a call kind in the status row. */
export function callWord(kind: CallKind): string {
  return kind === 'teams' ? 'Teams' : kind === 'zoom' ? 'Zoom' : 'browser';
}

export type StatusTone = 'call' | 'now' | 'next';

/**
 * The status row's words: "In call, Teams" during a call; "Now" when the meeting has started and no call is
 * sensed; "Next, in 20 min", "Next, in 1 h 05 min" or "Next, at 3:30 PM" (more than three hours away) before it.
 */
export function statusLine(m: Pick<Meeting, 'start' | 'end'>, now: number, call: CallSignal | null): { text: string; tone: StatusTone } {
  if (call) return { text: `In call, ${callWord(call.kind)}`, tone: 'call' };
  const start = Date.parse(m.start);
  if (start <= now) return { text: 'Now', tone: 'now' };
  const mins = Math.ceil((start - now) / MIN);
  if (mins > 180) return { text: `Next, at ${clockText(start)}`, tone: 'next' };
  if (mins < 60) return { text: `Next, in ${mins} min`, tone: 'next' };
  return { text: `Next, in ${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`, tone: 'next' };
}

export type RingTone = 'cyan' | 'violet' | 'amber';

export interface Ring {
  /** The big number: minutes, or hours when a meeting is more than 99 minutes away. */
  value: number;
  unit: string;
  /** 0 to 1, how much of the ring is drawn. */
  frac: number;
  tone: RingTone;
  /** Under the ring: "ends 11:30 AM" once started, "starts 10:30 AM" before. */
  under: string;
}

/**
 * The ring. Before the start it counts minutes to go and fills for the last 30 minutes; once the
 * meeting has started it counts minutes left and its fraction is the time left of the meeting's
 * length. Cyan before or with no call sensed, violet in a call, amber with 10 minutes or less left.
 */
export function ringOf(m: Pick<Meeting, 'start' | 'end'>, now: number, inCall: boolean): Ring {
  const start = Date.parse(m.start);
  const end = Date.parse(m.end);
  if (start > now) {
    const togo = Math.ceil((start - now) / MIN);
    const hours = togo > 99;
    return { value: hours ? Math.floor(togo / 60) : togo, unit: hours ? 'h to go' : 'min to go', frac: Math.min(1, togo / 30), tone: 'cyan', under: `starts ${clockText(start)}` };
  }
  const left = Math.max(1, Math.ceil((end - now) / MIN));
  const length = Math.max(1, end - start);
  const frac = Math.min(1, Math.max(0, (end - now) / length));
  const tone: RingTone = left <= 10 ? 'amber' : inCall ? 'violet' : 'cyan';
  return { value: left > 99 ? Math.floor(left / 60) : left, unit: left > 99 ? 'h left' : 'min left', frac, tone, under: `ends ${clockText(end)}` };
}

/** Two letters for a circle: the first letters of the first and the last word. */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = [...words[0]][0] ?? '';
  const last = words.length > 1 ? [...words[words.length - 1]][0] ?? '' : '';
  return `${first}${last}`.toUpperCase();
}

/** People who are drawn: nobody who declined. */
export function drawnPeople(d: MeetingDetails | null | undefined): Person[] {
  return (d?.people ?? []).filter((p) => p.reply !== 'no');
}

/** How many people are invited, named or not. */
export function invitedCount(d: MeetingDetails | null | undefined): number {
  return d ? d.people.length + d.peopleMore : 0;
}

/** The most round things (initials circles and the "+N" one) the people block holds: 5 circles of 40 px overlapping by 8 are 168 px. */
export const MAX_CIRCLES = 5;

export interface PeopleBlock {
  /** The names drawn as initials circles: five, or four when a "+N" circle follows. */
  circles: Person[];
  /** "+N": the drawn people past five, and every invited person not named. */
  more: number;
  /** "6 invited". The wall cannot tell who is on the call, so the call does not change it. */
  head: string;
  /** "4 said yes, 1 maybe", or "No replies yet". */
  replies: string;
}

/** The people block of the hero, or null when the invite names nobody and counts nobody. */
export function peopleBlock(d: MeetingDetails | null | undefined): PeopleBlock | null {
  const total = invitedCount(d);
  if (!d || total === 0) return null;
  const drawn = drawnPeople(d);
  const yes = d.people.filter((p) => p.reply === 'yes' || p.reply === 'organizer').length;
  const maybe = d.people.filter((p) => p.reply === 'maybe').length;
  const parts = [yes > 0 ? `${yes} said yes` : '', maybe > 0 ? `${maybe} maybe` : ''].filter(Boolean);
  // At most five round things fit the block: five circles, or four and the "+N" that counts everyone else.
  const room = MAX_CIRCLES - (d.peopleMore > 0 ? 1 : 0);
  const circles = drawn.length <= room ? drawn : drawn.slice(0, MAX_CIRCLES - 1);
  return {
    circles,
    more: drawn.length - circles.length + d.peopleMore,
    head: `${total} invited`,
    replies: parts.length > 0 ? parts.join(', ') : 'No replies yet',
  };
}

/** "Called by Avery Example · Work", from the person and the account label; null with neither. */
export function calledByLine(d: MeetingDetails | null | undefined, label: string): string | null {
  const parts = [d?.calledBy ? `Called by ${d.calledBy}` : '', label].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export interface CallKeySpec {
  /** The key library id the press sends. */
  id: string;
  /** What the hero's key says; the Camera key follows the camera signal. */
  label: string;
  role: 'mute' | 'camera' | 'share' | 'leave';
}

const KEY_ROLES: readonly CallKeySpec['role'][] = ['mute', 'camera', 'share', 'leave'];
const KEY_LABEL: Record<CallKeySpec['role'], string> = { mute: 'Mute', camera: 'Camera', share: 'Share', leave: 'Leave' };

/** The four call keys for Teams or Zoom, by library id; null for a call in the browser, which takes no shortcuts. */
export function callKeys(kind: CallKind, camera: boolean): CallKeySpec[] | null {
  if (kind === 'browser') return null;
  return KEY_ROLES.map((role) => ({ id: `${kind}-${role}`, role, label: role === 'camera' ? (camera ? 'Camera on' : 'Camera off') : KEY_LABEL[role] }));
}

/** The four dashed placeholder keys of a call in the browser. */
export const BROWSER_KEYS: readonly { role: CallKeySpec['role']; label: string }[] = KEY_ROLES.map((role) => ({ role, label: KEY_LABEL[role] }));

export const MUTE_TIP = (kind: CallKind): string => `Sends ${kind === 'zoom' ? 'Alt+A' : 'Ctrl+Shift+M'} to ${callWord(kind)}. The wall cannot see whether you are muted.`;
export const BROWSER_TIP = 'A call in the browser takes no shortcuts from the wall';

/** The day event Open invite opens: same start and title as the hero meeting, and one Outlook can open. */
export function matchDayEvent<T extends { key: string; title: string; start: string; canOpen?: boolean }>(m: Pick<Meeting, 'title' | 'start'>, events: readonly T[]): T | undefined {
  return events.find((e) => e.canOpen === true && e.start === m.start && e.title === m.title);
}

export interface NextHeading {
  text: string;
  amber: boolean;
}

/** An after-meeting this close to the hero's end is back to back. */
export const BACK_TO_BACK_MS = 2 * MIN;

/** "Next" in a call, "After this" before the hero starts, "Next, back to back" (amber) when the next one starts within 2 minutes of the hero's end. */
export function nextHeading(hero: Pick<Meeting, 'start' | 'end'>, after: Pick<Meeting, 'start'> | undefined, inCall: boolean): NextHeading {
  if (after && Date.parse(after.start) - Date.parse(hero.end) <= BACK_TO_BACK_MS) return { text: 'Next, back to back', amber: true };
  return { text: inCall ? 'Next' : 'After this', amber: false };
}

/** True when the leave signal is for this meeting: the real start it names is this meeting's start. */
export function leaveIsFor(leave: LeaveSignal | null, m: Pick<Meeting, 'start'>): boolean {
  return leave !== null && Math.abs(leave.startsAt - Date.parse(m.start)) <= MIN;
}
