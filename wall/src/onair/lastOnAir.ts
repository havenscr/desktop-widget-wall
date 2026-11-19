import { formatShowTime, localDate } from './model';
import type { PageMode } from './modes';

/** What the idle page remembers about the last time something was on air: kept by the page when a mode ends. */
export interface LastOnAir {
  /** When it ended, in ms. */
  endedAt: number;
  mode: PageMode;
  lengthMs: number;
  marks: number;
}

export const LAST_KEY = 'wall2-onair-last';

/** The record in storage, checked on read: anything malformed is no record. */
export function parseLast(raw: string | null): LastOnAir | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
    if (!ok(o.endedAt) || !ok(o.lengthMs) || !ok(o.marks)) return null;
    if (o.mode !== 'live' && o.mode !== 'rec' && o.mode !== 'meet') return null;
    return { endedAt: o.endedAt, mode: o.mode, lengthMs: o.lengthMs, marks: Math.floor(o.marks) };
  } catch {
    return null;
  }
}

export function readLast(): LastOnAir | null {
  try {
    return parseLast(window.localStorage.getItem(LAST_KEY));
  } catch {
    return null;
  }
}

export function writeLast(rec: LastOnAir): void {
  try {
    window.localStorage.setItem(LAST_KEY, JSON.stringify(rec));
  } catch {
    // Not kept this time; the page shows nothing for it.
  }
}

const FOR: Record<PageMode, string> = { live: 'Live for', rec: 'Recording for', meet: 'Presenting for' };

/** "Live for 58:12". */
export const lengthLine = (r: LastOnAir): string => `${FOR[r.mode]} ${formatShowTime(r.lengthMs)}`;

/** "4 marks saved", "1 mark saved", "No marks saved". */
export const marksLine = (n: number): string => (n === 0 ? 'No marks saved' : `${n} ${n === 1 ? 'mark' : 'marks'} saved`);

/** "Today, 10:02 AM", "Yesterday, 4:30 PM" or a short date. */
export function whenLine(endedAt: number, now: number): string {
  const time = new Date(endedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = localDate(endedAt);
  if (day === localDate(now)) return `Today, ${time}`;
  if (day === localDate(now - 24 * 60 * 60 * 1000)) return `Yesterday, ${time}`;
  return `${new Date(endedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}
