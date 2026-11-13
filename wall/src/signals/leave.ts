import type { Meeting } from '../meet/model';

export interface CalendarBlock extends Pick<Meeting, 'key' | 'title' | 'start' | 'end'> {
  isAllDay?: boolean;
}

const clock = (ms: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ms);
  const get = (part: string) => Number(parts.find((p) => p.type === part)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
};

/** Read only a clock explicitly labelled start or starts inside parentheses. */
export function parseRealStart(
  title: string,
  blockStart: string | number,
  blockEnd: string | number,
  timeZone: string,
  isAllDay = false,
): number | null {
  if (isAllDay) return null;
  const from = typeof blockStart === 'number' ? blockStart : Date.parse(blockStart);
  const to = typeof blockEnd === 'number' ? blockEnd : Date.parse(blockEnd);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return null;
  const groups = title.match(/\([^()]*(?:starts?|start)[^()]*\)/gi) ?? [];
  for (const group of groups) {
    const m = /(?:starts?\s+)?(\d{1,2})(?::?([0-5]\d))?\s*(am|pm)?(?:\s+starts?)?/i.exec(group);
    if (!m || !/starts?/i.test(group)) continue;
    let hour = Number(m[1]);
    const minute = m[2] ? Number(m[2]) : 0;
    const meridiem = m[3]?.toLowerCase();
    if (meridiem) {
      if (hour < 1 || hour > 12) continue;
      hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
    } else if (hour > 23) continue;
    const localDay = clock(from, timeZone);
    for (let at = from + 60_000; at <= to; at += 60_000) {
      const c = clock(at, timeZone);
      if (c.year !== localDay.year || c.month !== localDay.month || c.day !== localDay.day || c.minute !== minute) continue;
      if (meridiem ? c.hour === hour : c.hour === hour || (hour <= 12 && c.hour === hour + 12)) return at;
    }
  }
  return null;
}

