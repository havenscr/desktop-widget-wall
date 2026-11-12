import { expect, it } from 'vitest';
import { closeSession, dayKey, MAX_SESSIONS, openSession, parseDay, serializeDay, sessionsOn } from './day';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const MIN = 60_000;

it('names the local day', () => {
  expect(dayKey(at(11, 0, 5))).toBe('2026-11-11');
  expect(dayKey(at(11, 23, 59))).toBe('2026-11-11');
});

it('opens a session to its planned end and drops earlier days', () => {
  const old = [{ start: at(10, 9), end: at(10, 9, 25) }];
  expect(openSession(old, at(11, 10), at(11, 10, 25))).toEqual([{ start: at(11, 10), end: at(11, 10, 25) }]);
});

it('closes the last session early, never later than planned', () => {
  const s = [{ start: at(11, 10), end: at(11, 10, 25) }];
  expect(closeSession(s, at(11, 10, 10))).toEqual([{ start: at(11, 10), end: at(11, 10, 10) }]);
  expect(closeSession(s, at(11, 11))).toBe(s);
  expect(closeSession([], at(11, 11))).toEqual([]);
});

it('clips sessions to the given day, so one across midnight shows on both days', () => {
  const s = [
    { start: at(10, 20), end: at(10, 21) },
    { start: at(10, 23, 50), end: at(11, 0, 15) },
    { start: at(11, 9), end: at(11, 9, 30) },
  ];
  expect(sessionsOn(s, at(11, 12))).toEqual([
    { start: at(11, 0), end: at(11, 0, 15) },
    { start: at(11, 9), end: at(11, 9, 30) },
  ]);
  expect(sessionsOn(s, at(10, 22))).toEqual([
    { start: at(10, 20), end: at(10, 21) },
    { start: at(10, 23, 50), end: at(11, 0) },
  ]);
});

it('keeps a session that ran past midnight when the next one opens', () => {
  const s = [
    { start: at(10, 9), end: at(10, 9, 25) },
    { start: at(10, 23, 50), end: at(11, 0, 15) },
  ];
  expect(openSession(s, at(11, 10), at(11, 10, 25))).toEqual([s[1], { start: at(11, 10), end: at(11, 10, 25) }]);
});

it('round-trips a save and skips bad entries', () => {
  const s = [{ start: at(11, 9), end: at(11, 9, 30) }];
  expect(parseDay(serializeDay(s))).toEqual(s);
  expect(parseDay(null)).toEqual([]);
  expect(parseDay('{nope')).toEqual([]);
  expect(parseDay(JSON.stringify({ sessions: [{ start: 5, end: 1 }, { start: 'a', end: 2 }, null, ...s] }))).toEqual(s);
});

it('caps the list', () => {
  let s = [] as ReturnType<typeof openSession>;
  for (let i = 0; i < MAX_SESSIONS + 5; i++) s = openSession(s, at(11, 6) + i * 10 * MIN, at(11, 6) + i * 10 * MIN + 5 * MIN);
  expect(s).toHaveLength(MAX_SESSIONS);
});
