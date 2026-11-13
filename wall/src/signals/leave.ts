import type { Meeting } from '../meet/model';

export interface CalendarBlock extends Pick<Meeting, 'key' | 'title' | 'start' | 'end'> {
  isAllDay?: boolean;
}

/** Travel blocks are ordinary calendar blocks. Longer spans are refused before conversion. */
export const MAX_BLOCK_MS = 24 * 60 * 60_000;

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
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > MAX_BLOCK_MS) return null;
  const groups = title.match(/\([^()]*(?:starts?|start)[^()]*\)/gi) ?? [];
  for (const group of groups) {
    const inside = group.slice(1, -1).trim();
    const m = /^(?:starts?\s+(\d{1,2})(?::?([0-5]\d))?\s*(am|pm)?|(\d{1,2})(?::?([0-5]\d))?\s*(am|pm)?\s+starts?)$/i.exec(inside);
    if (!m) continue;
    let hour = Number(m[1] ?? m[4]);
    const minuteText = m[2] ?? m[5];
    const minute = minuteText ? Number(minuteText) : 0;
    const meridiem = (m[3] ?? m[6])?.toLowerCase();
    if (meridiem) {
      if (hour < 1 || hour > 12) continue;
      hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
    } else if (hour > 23) continue;
    const day = clock(from, timeZone);
    const hours = meridiem ? [hour] : [hour, ...(hour <= 12 ? [hour + 12] : [])];
    const probes = [from, to, Date.UTC(day.year, day.month - 1, day.day, 0), Date.UTC(day.year, day.month - 1, day.day, 12)];
    const offsets = new Set(probes.map((at) => {
      const c = clock(at, timeZone);
      return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute) - at;
    }));
    const candidates = hours.flatMap((h) => [...offsets].map((offset) => Date.UTC(day.year, day.month - 1, day.day, h, minute) - offset)).sort((a, b) => a - b);
    for (const at of candidates) {
      if (at <= from || at > to) continue;
      const c = clock(at, timeZone);
      if (c.year === day.year && c.month === day.month && c.day === day.day && hours.includes(c.hour) && c.minute === minute) return at;
    }
  }
  return null;
}
