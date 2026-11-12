import { expect, it } from 'vitest';
import { nextLine, shortClock } from './next';

const at = (h: number, m: number, day = 11) => new Date(2026, 10, day, h, m).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

it('writes the Next line as the concept does', () => {
  expect(nextLine({ start: iso(at(12, 0)), end: iso(at(12, 30)) }, at(10, 24))).toBe('12:00, in 1 h 36 m');
  expect(nextLine({ start: iso(at(10, 48)), end: iso(at(11, 0)) }, at(10, 24))).toBe('10:48, in 24 m');
  expect(nextLine({ start: iso(at(10, 0)), end: iso(at(10, 36)) }, at(10, 24))).toBe('now, 12 m left');
  expect(nextLine({ start: iso(at(9, 30, 12)), end: iso(at(10, 0, 12)) }, at(16, 0))).toBe('tomorrow 9:30');
});

it('writes 12-hour times without AM or PM', () => {
  expect(shortClock(at(0, 5))).toBe('12:05');
  expect(shortClock(at(15, 30))).toBe('3:30');
});

it('names the weekday two or more days out, and writes whole hours without minutes', () => {
  // 2026-11-11 is a Wednesday; the 13th is a Friday.
  expect(nextLine({ start: iso(at(9, 30, 13)), end: iso(at(10, 0, 13)) }, at(16, 0))).toBe('Friday 9:30');
  expect(nextLine({ start: iso(at(11, 24)), end: iso(at(12, 0)) }, at(10, 24))).toBe('11:24, in 1 h');
  expect(nextLine({ start: iso(at(10, 0)), end: iso(at(12, 24)) }, at(10, 24))).toBe('now, 2 h left');
});

it('drops the countdown while the list is stale and keeps only the times', () => {
  expect(nextLine({ start: iso(at(12, 0)), end: iso(at(12, 30)) }, at(10, 24), true)).toBe('12:00');
  expect(nextLine({ start: iso(at(10, 0)), end: iso(at(10, 36)) }, at(10, 24), true)).toBe('10:00 to 10:36');
  expect(nextLine({ start: iso(at(9, 30, 12)), end: iso(at(10, 0, 12)) }, at(16, 0), true)).toBe('tomorrow 9:30');
  expect(nextLine({ start: iso(at(12, 0)), end: iso(at(12, 30)) }, at(10, 24), true)).not.toMatch(/in \d/);
});
