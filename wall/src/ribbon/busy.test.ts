import { describe, expect, it } from 'vitest';
import type { DaySpan } from '../agents/model';
import { lane, summary } from '../agents/fixtures';
import { busyAt, busyLevels, busyPeak, busyStep, busyTime, parentIds, settleOpenRuns, stepsFor, stepWords, timeBySteps, todayLimitText, workingSpans } from './busy';
import { activityCells } from './model';
import { usePacificTime } from './testZone';

usePacificTime();

const at = (hm: string) => Date.parse(`2026-11-13T${hm}:00-08:00`);
const NOW = at('12:00');
const MIN = 60_000;

it('counts only working runs of parent and standalone sessions: waits, review spans and children do not count', () => {
  const s = summary({ sessionsList: [lane({ id: 'p1' }), lane({ id: 'p2' }), lane({ id: 'p3' })], lanes: [] });
  const parents = parentIds(s, { date: '2026-11-13', tz: 'America/Los_Angeles', sessions: [{ id: 'gone', title: 'Closed earlier', spans: [], pr: null }] });
  expect([...parents]).toEqual(['p1', 'p2', 'p3', 'gone']);
  const segs = [
    { lane: 'p1', kind: 'past', start: at('09:00'), end: at('10:00') },
    // The same parent twice at once still counts once.
    { lane: 'p1', kind: 'run', start: at('09:30'), end: at('11:00') },
    { lane: 'p2', kind: 'wait', start: at('09:00'), end: at('11:00') },
    { lane: 'p3', kind: 'done', start: at('09:00'), end: at('11:00') },
    // A helper (child) of p1 working: never an extra session.
    { lane: 'kid-of-p1', kind: 'run', start: at('09:00'), end: at('11:00') },
    // A parent that closed earlier today, known from the saved record.
    { lane: 'gone', kind: 'past', start: at('09:45'), end: at('10:15') },
  ];
  const spans = workingSpans(segs, parents);
  // Slices in, counts out.
  const table: [string, number][] = [
    ['08:59', 0],
    ['09:00', 1],
    ['09:40', 1],
    ['09:45', 2],
    ['10:00', 2],
    ['10:15', 1],
    ['10:59', 1],
    ['11:00', 0],
  ];
  for (const [hm, n] of table) expect([hm, busyAt(spans, at(hm))]).toEqual([hm, n]);
  expect(busyPeak(spans, at('09:00'), at('11:00'))).toBe(2);
  expect(busyLevels(spans).map((l) => l.count)).toEqual([1, 2, 1]);
});

it('a cell takes the most working at once inside it, and the limit edge is exact', () => {
  const four = ['a', 'b', 'c', 'd'].map((id) => ({ lane: id, kind: 'run', start: at('09:00'), end: at('09:24') }));
  const fifth = { lane: 'e', kind: 'run', start: at('09:12'), end: at('09:13') };
  const cells = activityCells([...four, fifth], NOW);
  expect(cells.map((c) => c.busy)).toEqual([4, 5]);
  expect(cells.map((c) => busyStep(c.busy, 4))).toEqual([4, 5]);
  // A wait only: drawn, with nobody working.
  const wait = activityCells([{ lane: 'a', kind: 'wait', start: at('09:00'), end: at('09:10') }], NOW);
  expect(wait.map((c) => [c.busy, c.waits])).toEqual([[0, true]]);
});

it('the colour step for 1, 2, 3, 4, 5 and 9 against a limit of 4, and other limits', () => {
  expect([0, 1, 2, 3, 4, 5, 9].map((n) => busyStep(n, 4))).toEqual([0, 1, 2, 3, 4, 5, 5]);
  expect([1, 2, 3, 5, 6, 7].map((n) => busyStep(n, 6))).toEqual([1, 2, 3, 3, 4, 5]);
  expect([1, 2, 3].map((n) => busyStep(n, 2))).toEqual([1, 4, 5]);
  expect(stepsFor(4).map((s) => stepWords(s, 4))).toEqual(['at 1', 'at 2', 'at 3', 'at 4', 'over 4']);
  expect(stepsFor(6).map((s) => stepWords(s, 6))).toEqual(['at 1', 'at 2', 'at 3 to 5', 'at 6', 'over 6']);
  expect(stepsFor(2).map((s) => stepWords(s, 2))).toEqual(['at 1', 'at 2', 'over 2']);
});

it('the time at each step adds up to the time anyone worked, and the meter tip says the limit parts', () => {
  const spans = [
    { id: 'a', start: at('08:00'), end: at('11:00') },
    { id: 'b', start: at('08:30'), end: at('10:00') },
    { id: 'c', start: at('09:00'), end: at('09:30') },
    { id: 'd', start: at('09:10'), end: at('09:20') },
    { id: 'e', start: at('09:12'), end: at('09:18') },
    { id: 'f', start: at('12:00'), end: at('12:30') },
  ];
  const by = timeBySteps(spans, 4);
  // 1: 8:00 to 8:30, 10:00 to 11:00, 12:00 to 12:30. 2: 8:30 to 9:00, 9:30 to 10:00. 3: 9:00 to 9:10, 9:20 to 9:30.
  // 4: 9:10 to 9:12, 9:18 to 9:20. Over 4: 9:12 to 9:18.
  expect(by.slice(1).map((ms) => ms / MIN)).toEqual([120, 60, 20, 4, 6]);
  expect(by.reduce((a, b) => a + b, 0)).toBe(busyTime(spans));
  expect(busyTime(spans)).toBe(210 * MIN);
  expect(todayLimitText(by, 4)).toBe('Today: over 4 for 6 m, at 4 for 4 m.');
  expect(todayLimitText([0, 0, 0, 0, 12 * MIN, 108 * MIN], 4)).toBe('Today: over 4 for 1 h 48 m, at 4 for 12 m.');
  expect(todayLimitText([0, 5 * MIN, 0, 0, 0, 0], 4)).toBe('Today: never at your limit of 4.');
});

describe('settleOpenRuns', () => {
  const at = (hm: string) => Date.parse(`2026-11-11T${hm}:00Z`);
  const iso = (hm: string) => new Date(at(hm)).toISOString();
  const open = { lane: 'a', start: iso('09:00'), end: null, kind: 'run' as const };
  const card = (over: object = {}) => ({ id: 'a', title: 'A', stage: 'build', state: 'working', line: '', elapsedS: 0, waiting: false, pr: null, ...over }) as never;
  const none = new Set<string>();
  const parents = new Set(['a']);
  const settle = (day: DaySpan[], lanes: unknown[], seen: Map<string, number>, working = none) =>
    settleOpenRuns({ lanes: lanes as never, sessionsList: null, day }, parents, working, seen, at('11:30'), at('11:30'));

  it('(a) the helper\'s idle seconds come first, then its waiting seconds', () => {
    expect(settle([open], [card({ live: 'idle', idleS: 1800, waitingSinceS: 600 })], new Map([['a', at('10:00')]])).ends.get('a')).toBe(at('11:00'));
    expect(settle([open], [card({ state: 'blocked', waitingSinceS: 600 })], new Map()).ends.get('a')).toBe(at('11:20'));
  });
  it('(b) else the last time it was seen working', () => {
    const r = settle([open], [card({ live: 'idle' })], new Map([['a', at('10:45')]]));
    expect(r.day[0].end).toBe(iso('10:45'));
  });
  it('(c) else the latest stamp the log gives, else the run\'s own start', () => {
    const wait = { lane: 'a', start: iso('09:20'), end: iso('09:30'), kind: 'wait' as const };
    expect(settle([open, wait], [card({ live: 'idle' })], new Map()).ends.get('a')).toBe(at('09:30'));
    expect(settle([open], [card({ live: 'idle' })], new Map()).ends.get('a')).toBe(at('09:00'));
  });
  it('never ends before the run began or after the cut; a working card and a non-parent stay open', () => {
    expect(settle([open], [card({ live: 'idle' })], new Map([['a', at('08:00')]])).ends.get('a')).toBe(at('09:00'));
    expect(settle([open], [card({ live: 'idle', idleS: 0 })], new Map()).ends.get('a')).toBe(at('11:30'));
    expect(settle([open], [card()], new Map(), new Set(['a'])).day[0].end).toBeNull();
    const kid = { lane: 'kid', start: iso('09:00'), end: null, kind: 'run' as const };
    expect(settle([kid], [], new Map()).day[0].end).toBeNull();
  });
  it('keeps helper work open but caps an idle own turn at twelve hours', () => {
    const helpers = card({ live: 'idle', bg: { agents: 1, shells: 0 } });
    const beforeCap = settleOpenRuns(
      { lanes: [helpers], sessionsList: null, day: [open] },
      parents,
      new Set(['a']),
      new Map(),
      at('20:30'),
      at('20:30'),
    );
    expect(beforeCap.day[0].end).toBeNull();
    const afterCap = settleOpenRuns(
      { lanes: [helpers], sessionsList: null, day: [open] },
      parents,
      new Set(['a']),
      new Map(),
      at('23:30'),
      at('23:30'),
    );
    expect(afterCap.day[0].end).toBe(iso('21:00'));
    const ownTurn = settleOpenRuns(
      { lanes: [card({ live: 'working' })], sessionsList: null, day: [open] },
      parents,
      new Set(['a']),
      new Map(),
      at('23:30'),
      at('23:30'),
    );
    expect(ownTurn.day[0].end).toBeNull();
    const oldHelper = settleOpenRuns(
      { lanes: [card()], sessionsList: null, day: [open] },
      parents,
      new Set(['a']),
      new Map(),
      at('23:30'),
      at('23:30'),
    );
    expect(oldHelper.day[0].end).toBeNull();
  });
});
