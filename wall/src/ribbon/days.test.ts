import { expect, it } from 'vitest';
import { lane, summary } from '../agents/fixtures';
import { axisRange, dayBefore, isoDay, longDate, neighbours, recordRows, todayRows, totalsText, type DayRecord } from './days';
import { activityCells, agentsLineParts, agentsLineX, calmLayout, chips, foldCountWidth, RIBBON_WIDTH, RX } from './model';
import { usePacificTime } from './testZone';

usePacificTime();

const t = (d: string, hm: string) => Date.parse(`${d}T${hm}:00-08:00`);
const iso = (d: string, hm: string) => new Date(t(d, hm)).toISOString();
const NOW = t('2026-11-13', '10:24');

const record: DayRecord = {
  date: '2026-11-12',
  tz: 'America/Los_Angeles',
  sessions: [
    { id: 'a1b2c3d4-0001', title: 'Spend card refresh', spans: [{ stage: 'plan', start: iso('2026-11-12', '07:00'), end: iso('2026-11-12', '07:30') }, { stage: 'pr', start: iso('2026-11-12', '10:30'), end: iso('2026-11-12', '11:00') }], pr: { number: 552, state: 'merged' } },
    { id: 'a1b2c3d4-0002', title: 'Voice fix', spans: [{ stage: 'build', start: iso('2026-11-12', '20:00'), end: null }], pr: null },
    { id: 'a1b2c3d4-0003', title: 'Admin pill polish', spans: [{ stage: 'pr', start: iso('2026-11-12', '14:00'), end: iso('2026-11-12', '14:30') }], pr: { number: 561, state: 'open' } },
    { id: 'a1b2c3d4-0004', title: 'Docs tidy', spans: [{ stage: 'build', start: iso('2026-11-12', '09:00'), end: iso('2026-11-12', '10:00') }], pr: null },
  ],
};

it('a past day: stage spans, pull request marks and the end words', () => {
  const rows = recordRows(record, NOW);
  expect(rows.map((r) => r.end)).toEqual(['merged', 'carried over', 'pull request open', 'finished']);
  expect(rows[0].spans.map((s) => [s.kind, s.from, s.to])).toEqual([
    ['plan', 7, 7.5],
    ['pr', 10.5, 11],
  ]);
  expect(rows[0].prAt).toBe(10.5);
  expect(rows[0].pr).toBe(552);
  // An open span on a past day runs to the end of that day.
  expect(rows[1].spans[0].to).toBe(24);
  expect(rows[1].workMs).toBe(4 * 3_600_000);
  // A past day has no wait: no wait total in its words.
  expect(rows.every((r) => r.waitMs === 0)).toBe(true);
  expect(totalsText(rows, false)).toBe('6 h 30 m of agent work across 4 sessions');
});

it('today: live waits on top of the stage spans from today\'s record, runs in cyan for the rest', () => {
  const day = '2026-11-13';
  const s = summary({
    sessionsList: [lane({ id: 'a1b2c3d4-0001', title: 'Spend card refresh' }), lane({ id: 'a1b2c3d4-0002', waiting: true, state: 'blocked' })],
    day: [
      { lane: 'a1b2c3d4-0001', start: iso(day, '08:00'), end: null, kind: 'run' },
      { lane: 'a1b2c3d4-0002', start: iso(day, '09:00'), end: iso(day, '09:30'), kind: 'run' },
      { lane: 'a1b2c3d4-0002', start: iso(day, '09:30'), end: null, kind: 'wait' },
    ],
  });
  const rec: DayRecord = { date: day, tz: 'UTC', sessions: [{ id: 'a1b2c3d4-0001', title: 'Spend card refresh', spans: [{ stage: 'build', start: iso(day, '08:00'), end: null }], pr: null }] };
  const rows = todayRows(s, rec, NOW);
  expect(rows[0].spans.map((x) => x.kind)).toEqual(['build']);
  expect(rows[1].spans.map((x) => x.kind)).toEqual(['run', 'wait']);
  expect(rows.map((r) => r.end)).toEqual(['working', 'waiting on you']);
  expect(totalsText(rows, true)).toBe('2 h 54 m of agent work across 2 sessions, 0 h 54 m waiting on you');
  // With no record the live runs stay cyan.
  expect(todayRows(s, null, NOW)[0].spans.map((x) => x.kind)).toEqual(['run']);
});

it('the day picker steps through the recorded days, with today at the newest end', () => {
  const days = [
    { date: '2026-11-13', sessions: 3 },
    { date: '2026-11-12', sessions: 8 },
    { date: '2026-11-09', sessions: 2 },
  ];
  expect(neighbours(days, '2026-11-13', '2026-11-13')).toEqual({ prev: '2026-11-12', next: null });
  expect(neighbours(days, '2026-11-12', '2026-11-13')).toEqual({ prev: '2026-11-09', next: '2026-11-13' });
  expect(neighbours(days, '2026-11-09', '2026-11-13')).toEqual({ prev: null, next: '2026-11-12' });
  // An older helper: no record, only today.
  expect(neighbours([], '2026-11-13', '2026-11-13')).toEqual({ prev: null, next: null });
  expect(dayBefore('2026-11-01')).toBe('2026-10-31');
  expect(isoDay(NOW)).toBe('2026-11-13');
  expect(longDate('2026-11-12')).toBe('Thursday, November 12');
});

it('the axis runs 6 AM to midnight for a past day and to just past now today', () => {
  expect(axisRange([], false, 10.4)).toEqual({ lo: 6, hi: 24, step: 2 });
  expect(axisRange([], true, 10.4)).toEqual({ lo: 6, hi: 11, step: 1 });
  const early = recordRows({ ...record, sessions: [{ id: 'a1b2c3d4-0009', title: 'Early', spans: [{ stage: 'plan', start: iso('2026-11-12', '04:30'), end: iso('2026-11-12', '05:00') }], pr: null }] }, NOW);
  expect(axisRange(early, false, 10.4).lo).toBe(4);
});

it('folds a run of overlapping meetings into one chip, its count never narrower than its words', () => {
  const day = '2026-11-13';
  const ev = (key: string, a: string, b: string) => ({ key, title: key, start: iso(day, a), end: iso(day, b) });
  const c = chips([ev('a', '09:00', '09:15'), ev('b', '12:45', '13:45'), ev('c', '13:00', '14:00'), ev('d', '13:30', '15:30'), ev('e', '16:00', '16:05')], NOW);
  const l = calmLayout(c, NOW);
  expect(l.singles.map((x) => x.key)).toEqual(['a', 'e']);
  expect(l.folds).toHaveLength(1);
  expect(l.folds[0].count).toBe('3 at 1:30');
  expect(l.folds[0].x).toBeCloseTo(RX(12.75), 3);
  expect(l.folds[0].hour).toBeCloseTo(12.75, 3);
  // Two short meetings that overlap still show their whole count.
  const tiny = calmLayout(chips([ev('x', '09:00', '09:05'), ev('y', '09:02', '09:06')], NOW), NOW);
  expect(tiny.folds[0].width).toBe(foldCountWidth('2 at 9:02'));
  // An event that ends when the next begins does not overlap it.
  expect(calmLayout(chips([ev('p', '09:00', '10:00'), ev('q', '10:00', '11:00')], NOW), NOW).folds).toHaveLength(0);
});

it('the activity cells count sessions busy in each 12 minutes from 6 AM, amber where one waited', () => {
  const at = (hm: string) => t('2026-11-13', hm);
  const cells = activityCells(
    [
      { lane: 'a', kind: 'run', start: at('09:00'), end: at('09:30') },
      { lane: 'b', kind: 'wait', start: at('09:10'), end: at('09:20') },
    ],
    NOW,
  );
  expect(cells.map((c) => [c.busy, c.waits])).toEqual([
    [2, true],
    [2, true],
    [1, false],
  ]);
});

it('the agents line words and its place late in the day', () => {
  expect(agentsLineParts({ total: 12, need: 2, working: 5, idle: 5 })).toEqual({ head: '12 sessions: ', need: '2 need you', tail: ', 5 working' });
  expect(agentsLineParts({ total: 1, need: 0, working: 1, idle: 0 })).toEqual({ head: '1 session: ', need: null, tail: '1 working, 0 idle' });
  expect(agentsLineX(1000, 280)).toBe(1014);
  // Fewer than 360 px right of the needle: right-aligned before it.
  expect(agentsLineX(RIBBON_WIDTH - 300, 280)).toBe(RIBBON_WIDTH - 300 - 14 - 280);
});
