import { clockText, occurrenceId, type Meeting } from './model';

const MIN = 60_000;

/** The part of a day event (or of a meeting) the day counts need. */
export interface DayLike {
  accountId?: string;
  title: string;
  start: string;
  end: string;
}

const dayStart = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** 0 for today, 1 for tomorrow, and so on, by the local calendar day. */
export function daysAhead(startMs: number, now: number): number {
  return Math.round((dayStart(startMs) - dayStart(now)) / 86_400_000);
}

/** "" for today, "Tomorrow" for tomorrow, the short weekday after that. */
export function dayWord(startMs: number, now: number): string {
  const n = daysAhead(startMs, now);
  if (n <= 0) return '';
  if (n === 1) return 'Tomorrow';
  return new Date(startMs).toLocaleDateString('en-US', { weekday: 'short' });
}

/** "9:00 AM", or "Tomorrow 9:00 AM". */
export function whenText(startMs: number, now: number): string {
  const w = dayWord(startMs, now);
  return w ? `${w} ${clockText(startMs)}` : clockText(startMs);
}

const same = (a: DayLike, b: DayLike) => occurrenceId({ accountId: a.accountId ?? '', ...a }) === occurrenceId({ accountId: b.accountId ?? '', ...b });

/**
 * The rest of today after the hero: events that start today (by the local day), have not ended, are not the
 * hero itself and do not start before it (one that starts at the same minute is after it). Nothing is capped, and a meeting tomorrow is never in it.
 */
export function todayRest(events: readonly DayLike[], hero: DayLike | undefined, now: number): DayLike[] {
  return events
    .filter((e) => Date.parse(e.end) > now && daysAhead(Date.parse(e.start), now) === 0 && !(hero && same(e, hero)) && (!hero || Date.parse(e.start) >= Date.parse(hero.start)))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** The latest end among these (not the last row's: an earlier meeting may run longer), or null with none. */
export function latestEnd(list: readonly DayLike[]): number | null {
  return list.length === 0 ? null : Math.max(...list.map((e) => Date.parse(e.end)));
}

/** The meetings the next read lists after the hero: not ended, not the hero, starting after it. Nothing is capped here. */
export function meetingsAfter(meetings: readonly Meeting[], hero: Meeting | undefined, now: number): Meeting[] {
  return meetings.filter((m) => Date.parse(m.end) > now && !(hero && occurrenceId(m) === occurrenceId(hero)) && (!hero || Date.parse(m.start) >= Date.parse(hero.start)));
}

export { MIN };
