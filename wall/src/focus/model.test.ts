import { expect, it } from 'vitest';
import {
  adjustMinutes,
  clampMinutes,
  initialFocus,
  minutesLeft,
  pause,
  reset,
  restore,
  resume,
  ringFraction,
  serialize,
  start,
  tick,
} from './model';

const T = 1_000_000;
const MIN = 60_000;

it('clamps custom length to 5..120 in steps of 5', () => {
  expect(clampMinutes(1)).toBe(5);
  expect(clampMinutes(200)).toBe(120);
  expect(clampMinutes(32)).toBe(30);
  expect(adjustMinutes(120, 1)).toBe(120);
  expect(adjustMinutes(5, -1)).toBe(5);
  expect(adjustMinutes(25, 1)).toBe(30);
});

it('start stores an end time, not a countdown', () => {
  const s = start({ status: 'idle', minutes: 25 }, T);
  expect(s).toEqual({ status: 'running', minutes: 25, endAt: T + 25 * MIN });
  expect(minutesLeft(s, T + 5 * MIN)).toBe(20);
  expect(minutesLeft(s, T + 25 * MIN - 1)).toBe(1);
});

it('pause freezes the time left and resume sets a new end time', () => {
  const run = start(initialFocus, T);
  const paused = pause(run, T + 10 * MIN);
  expect(paused).toEqual({ status: 'paused', minutes: 25, remainingMs: 15 * MIN });
  const later = resume(paused, T + 60 * MIN);
  expect(later).toEqual({ status: 'running', minutes: 25, endAt: T + 75 * MIN });
});

it('finishes when the end time passes and resets to idle', () => {
  const run = start(initialFocus, T);
  expect(tick(run, T + 25 * MIN - 1).status).toBe('running');
  const done = tick(run, T + 25 * MIN);
  expect(done.status).toBe('finished');
  expect(reset(done)).toEqual({ status: 'idle', minutes: 25 });
  expect(start(done, T + 30 * MIN).status).toBe('running');
});

it('resumes correctly after a restart', () => {
  const saved = serialize(start({ status: 'idle', minutes: 50 }, T));
  const back = restore(saved, T + 20 * MIN);
  expect(back.status).toBe('running');
  expect(minutesLeft(back, T + 20 * MIN)).toBe(30);
  expect(ringFraction(back, T + 25 * MIN)).toBeCloseTo(0.5);
});

it('shows finished when the timer ended while the app was closed', () => {
  const saved = serialize(start(initialFocus, T));
  expect(restore(saved, T + 3 * 60 * MIN)).toEqual({ status: 'finished', minutes: 25 });
});

it('restores paused state and survives bad data', () => {
  const p = pause(start(initialFocus, T), T + 5 * MIN);
  expect(restore(serialize(p), T + 999 * MIN)).toEqual(p);
  expect(restore(null, T)).toEqual(initialFocus);
  expect(restore('garbage', T)).toEqual(initialFocus);
  expect(restore('{"status":"running"}', T)).toEqual({ status: 'idle', minutes: 25 });
});

it('treats a restored end time beyond the longest session as corrupt', () => {
  const raw = JSON.stringify({ status: 'running', minutes: 25, endAt: T + 121 * MIN });
  expect(restore(raw, T)).toEqual({ status: 'idle', minutes: 25 });
  const ok = JSON.stringify({ status: 'running', minutes: 120, endAt: T + 120 * MIN });
  expect(restore(ok, T).status).toBe('running');
});
