import type { CallKind, CallSignal, LeaveSignal } from '../signals/model';
import { clockText, timeRange, type Meeting, type MeetingDetails, type Person } from './model';

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
  /** Under the ring: the time range before the meeting, "ends 11:30 AM" during it, "ended 11:00 AM" after it. */
  under: string;
}

/**
 * The ring. Before the start it counts minutes to go and fills for the last 30 minutes; once the meeting has
 * started it counts minutes left, as a share of the meeting's length; past the end of the meeting (a call that
 * runs over) it counts the minutes over, in amber, full, under "ended 11:00 AM". Cyan before or with no call
 * sensed, violet in a call (also before the start, for a call joined early), amber with 10 minutes or less
 * left and when over.
 */
export function ringOf(m: Pick<Meeting, 'start' | 'end'>, now: number, inCall: boolean): Ring {
  const start = Date.parse(m.start);
  const end = Date.parse(m.end);
  if (now >= end && now >= start) {
    const over = Math.floor((now - end) / MIN);
    return { value: over > 99 ? Math.floor(over / 60) : over, unit: over > 99 ? 'h over' : 'min over', frac: 1, tone: 'amber', under: `ended ${clockText(end)}` };
  }
  if (start > now) {
    const togo = Math.ceil((start - now) / MIN);
    const hours = togo > 99;
    return { value: hours ? Math.floor(togo / 60) : togo, unit: hours ? 'h to go' : 'min to go', frac: Math.min(1, togo / 30), tone: inCall ? 'violet' : 'cyan', under: timeRange(m) };
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

/**
 * The day event Open invite opens: the one whose account, start, end and title are the hero meeting's, and only when
 * exactly one day event matches (two look-alikes would open the wrong one) and Outlook can open it.
 */
export function matchDayEvent<T extends { key: string; accountId?: string; title: string; start: string; end: string; canOpen?: boolean }>(m: Pick<Meeting, 'accountId' | 'title' | 'start' | 'end'>, events: readonly T[]): T | undefined {
  const hits = events.filter((e) => e.accountId === m.accountId && e.start === m.start && e.end === m.end && e.title === m.title);
  return hits.length === 1 && hits[0].canOpen === true ? hits[0] : undefined;
}

export interface NextHeading {
  text: string;
  amber: boolean;
  /** How the meeting after the hero sits against its end. */
  relation: 'apart' | 'back' | 'overlap';
}

/** An after-meeting starting from this long before to this long after the hero's end is back to back. */
export const BACK_TO_BACK_MS = 2 * MIN;

/**
 * "Next" in a call, "After this" before the hero starts. In amber: "Next, back to back" when the next meeting starts
 * from 2 minutes before to 2 minutes after the hero's end, and "Next, overlaps" when it starts earlier than that.
 */
export function nextHeading(hero: Pick<Meeting, 'start' | 'end'> | undefined, after: Pick<Meeting, 'start'> | undefined, inCall: boolean): NextHeading {
  if (hero && after) {
    const gap = Date.parse(after.start) - Date.parse(hero.end);
    if (Math.abs(gap) <= BACK_TO_BACK_MS) return { text: 'Next, back to back', amber: true, relation: 'back' };
    if (gap < 0) return { text: 'Next, overlaps', amber: true, relation: 'overlap' };
  }
  return { text: inCall ? 'Next' : 'After this', amber: false, relation: 'apart' };
}

/** The amber line under the heading when the next meeting is back to back or overlaps. */
export function relationLine(rel: NextHeading['relation']): string | null {
  return rel === 'back' ? 'Starts as this one ends' : rel === 'overlap' ? 'Starts before this one ends' : null;
}

export interface LeaveWords {
  text: string;
  /** Amber when the leave time is before the hero ends. */
  amber: boolean;
}

/**
 * "Leave by 11:40 AM"; in a call, ", 10 min after this" (minutes from the hero's end to the leave time) when that is 0 or
 * more, and "Leave by 11:40 AM, before this ends" in amber when it is earlier than the hero's end.
 */
export function leaveWords(leaveAt: number, hero: Pick<Meeting, 'end'> | undefined, inCall: boolean): LeaveWords {
  const base = `Leave by ${clockText(leaveAt)}`;
  if (!hero || !inCall) return { text: base, amber: false };
  const mins = Math.round((leaveAt - Date.parse(hero.end)) / MIN);
  return mins >= 0 ? { text: `${base}, ${mins} min after this`, amber: false } : { text: `${base}, before this ends`, amber: true };
}

/** True when the leave signal is for this meeting: the real start it names is this meeting's start. */
export function leaveIsFor(leave: LeaveSignal | null, m: Pick<Meeting, 'start'>): boolean {
  return leave !== null && Math.abs(leave.startsAt - Date.parse(m.start)) <= MIN;
}
