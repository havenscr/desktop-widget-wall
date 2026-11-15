import { expect, it } from 'vitest';
import { occurrenceId } from './model';
import { dayWord, daysAhead, latestEnd, meetingsAfter, todayRest, whenText } from './todayModel';

// Local times, so the days are right in any time zone.
const NOW = new Date(2026, 10, 12, 10, 0).getTime();
const local = (day: number, h: number, mins = 0) => new Date(2026, 10, 12 + day, h, mins).toISOString();
const ev = (title: string, start: string, end: string, accountId = 'work') => ({ accountId, title, start, end });

it('days ahead and the words for them follow the local calendar day', () => {
  expect(daysAhead(new Date(2026, 10, 12, 23, 59).getTime(), NOW)).toBe(0);
  expect(daysAhead(new Date(2026, 10, 13, 0, 1).getTime(), NOW)).toBe(1);
  expect(dayWord(new Date(2026, 10, 12, 15).getTime(), NOW)).toBe('');
  expect(dayWord(new Date(2026, 10, 13, 9).getTime(), NOW)).toBe('Tomorrow');
  expect(dayWord(new Date(2026, 10, 15, 9).getTime(), NOW)).toBe('Sun');
  expect(whenText(new Date(2026, 10, 13, 9).getTime(), NOW)).toBe('Tomorrow 9 AM');
  expect(whenText(new Date(2026, 10, 12, 14, 30).getTime(), NOW)).toBe('2:30 PM');
});

it('nine meetings today after the hero are nine, with no cap', () => {
  const hero = ev('Hero', local(0, 9), local(0, 10, 30));
  const events = [hero, ...Array.from({ length: 9 }, (_, i) => ev(`M${i}`, local(0, 11 + i), local(0, 11 + i, 30)))];
  const rest = todayRest(events, hero, NOW);
  expect(rest).toHaveLength(9);
  expect(rest[0].title).toBe('M0');
});

it('the latest end is the maximum, not the last row\'s', () => {
  const hero = ev('Hero', local(0, 9), local(0, 10, 30));
  const rest = todayRest([ev('Long', local(0, 11), local(0, 18)), ev('Short', local(0, 12), local(0, 12, 30)), ev('Late', local(0, 13), local(0, 13, 30))], hero, NOW);
  expect(latestEnd(rest)).toBe(new Date(2026, 10, 12, 18).getTime());
  expect(latestEnd([])).toBeNull();
});

it('a meeting tomorrow is never counted as today, and one that ended is not counted', () => {
  const hero = ev('Hero', local(0, 9), local(0, 10, 30));
  const rest = todayRest([ev('Tomorrow', local(1, 9), local(1, 10)), ev('Done', local(0, 8), local(0, 8, 30)), ev('Later', local(0, 15), local(0, 16))], hero, NOW);
  expect(rest.map((e) => e.title)).toEqual(['Later']);
  expect(todayRest([ev('Tomorrow', local(1, 9), local(1, 10))], hero, NOW)).toEqual([]);
});

it('a meeting that starts today and crosses midnight is today\'s, with its real end', () => {
  const hero = ev('Hero', local(0, 9), local(0, 10, 30));
  const rest = todayRest([ev('Night', local(0, 23), local(1, 0, 30))], hero, NOW);
  expect(rest).toHaveLength(1);
  expect(latestEnd(rest)).toBe(new Date(2026, 10, 13, 0, 30).getTime());
});

it('the hero itself and anything starting before it are left out; with no hero everything left today counts', () => {
  const hero = ev('Hero', local(0, 9), local(0, 11));
  const events = [hero, ev('Earlier', local(0, 8), local(0, 12)), ev('Next', local(0, 11), local(0, 12))];
  expect(todayRest(events, hero, NOW).map((e) => e.title)).toEqual(['Next']);
  expect(todayRest(events, undefined, NOW).map((e) => e.title)).toEqual(['Earlier', 'Hero', 'Next']);
});

it('meetings after the hero come from the read without a cap and without the hero', () => {
  const mk = (n: number, startH: number) => ({ key: `k${n}`, accountId: 'work', title: `M${n}`, start: local(0, startH), end: local(0, startH, 30), canJoin: false });
  const list = Array.from({ length: 20 }, (_, i) => mk(i, 9 + (i % 12)));
  const hero = list[0];
  const out = meetingsAfter(list, hero, NOW - 3_600_000 * 2);
  expect(out.some((m) => occurrenceId(m) === occurrenceId(hero))).toBe(false);
  expect(out.length).toBeGreaterThan(14);
});
