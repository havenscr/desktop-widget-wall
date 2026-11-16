import { describe, expect, it } from 'vitest';
import { backAfterGap, emptyDay, parseTakes, reduceTakes, STORAGE_KEY, takeClock, takeMs, takesLine, TAKE_RESUME_MS, type Takes } from './takeModel';
import { RECORDING_GAP_MS as TAKE_GAP_MS } from '../signals/RecordingChip';

const MIN = 60_000;
// Local times, so the day rules hold in any zone.
const T = new Date(2026, 10, 11, 10, 20).getTime();
const run = (events: Parameters<typeof reduceTakes>[1][], from: Takes = emptyDay(T)) => events.reduce(reduceTakes, from);

describe('takes', () => {
  it('a start begins a take at now and counts it', () => {
    const t = run([{ type: 'on', now: T }]);
    expect(t.count).toBe(1);
    expect(t.current).toEqual({ startedAt: T, pausedAt: null, pausedMs: 0, seenAt: T });
  });
  it('an end closes it into the longest', () => {
    const t = run([{ type: 'on', now: T }, { type: 'off', now: T + 6 * MIN }]);
    expect(t.current).toBeNull();
    expect(t.longestMs).toBe(6 * MIN);
    expect(t.count).toBe(1);
  });
  it('the longest keeps the larger of two takes', () => {
    const t = run([{ type: 'on', now: T }, { type: 'off', now: T + 6 * MIN }, { type: 'on', now: T + 10 * MIN }, { type: 'off', now: T + 12 * MIN }]);
    expect(t.count).toBe(2);
    expect(t.longestMs).toBe(6 * MIN);
  });
  it('back under the gap is the same take, over it is a new one', () => {
    const before = run([{ type: 'on', now: T }]);
    const afterOff = reduceTakes(before, { type: 'off', now: T + 5 * MIN });
    const same = backAfterGap(before, T + 5 * MIN, T + 5 * MIN + TAKE_GAP_MS);
    expect(same?.count).toBe(1);
    expect(same?.current?.startedAt).toBe(T);
    expect(backAfterGap(before, T + 5 * MIN, T + 5 * MIN + TAKE_GAP_MS + 1)).toBeNull();
    expect(afterOff.current).toBeNull();
    expect(reduceTakes(afterOff, { type: 'on', now: T + 5 * MIN + TAKE_GAP_MS + 1 }).count).toBe(2);
    // Nothing to go back to when no take was running.
    expect(backAfterGap(emptyDay(T), T, T + 1)).toBeNull();
  });
  it('back after a short gap while paused: the pause is cleared and the time up to the off moment is banked', () => {
    const paused = run([{ type: 'on', now: T }, { type: 'pause', now: T + 2 * MIN }]);
    // Off for five seconds, then on again.
    const back = backAfterGap(paused, T + 2 * MIN + 3_000, T + 2 * MIN + 8_000);
    expect(back?.current?.pausedAt).toBeNull();
    expect(back?.current?.pausedMs).toBe(3_000);
    expect(back?.current?.startedAt).toBe(T);
    // The time stops counting at the pause and starts again after: 2 min before the pause, then the take runs on from the off moment's bank.
    expect(takeMs(back!.current!, T + 2 * MIN + 8_000 + MIN)).toBe(2 * MIN + 5_000 + MIN);
  });
  it('a take found in storage goes on when it was seen a moment ago, else it ends where it was last seen', () => {
    const stored = run([{ type: 'on', now: T }]);
    const soon = reduceTakes(stored, { type: 'on', now: T + TAKE_RESUME_MS });
    expect(soon.count).toBe(1);
    expect(soon.current?.startedAt).toBe(T);
    const late = reduceTakes(stored, { type: 'on', now: T + TAKE_RESUME_MS + 1 });
    expect(late.count).toBe(2);
    expect(late.current?.startedAt).toBe(T + TAKE_RESUME_MS + 1);
    expect(late.longestMs).toBe(0);
  });
  it('after local midnight the count starts again', () => {
    const night = new Date(2026, 10, 11, 23, 59).getTime();
    const t = run([{ type: 'on', now: night }, { type: 'off', now: night + 30_000 }], emptyDay(night));
    const next = reduceTakes(t, { type: 'on', now: night + 2 * MIN });
    expect(next.day).not.toBe(t.day);
    expect(next.count).toBe(1);
    expect(next.longestMs).toBe(0);
  });
  it('pause counts only on the event the page sends after Rust answered, and time paused is left out', () => {
    let t = run([{ type: 'on', now: T }]);
    t = reduceTakes(t, { type: 'pause', now: T + 2 * MIN });
    expect(takeMs(t.current!, T + 5 * MIN)).toBe(2 * MIN);
    t = reduceTakes(t, { type: 'resume', now: T + 5 * MIN });
    expect(t.current?.pausedAt).toBeNull();
    expect(takeMs(t.current!, T + 6 * MIN)).toBe(3 * MIN);
    // A pause or a resume with nothing to pause changes nothing.
    expect(reduceTakes(emptyDay(T), { type: 'pause', now: T })).toEqual(emptyDay(T));
    expect(reduceTakes(t, { type: 'resume', now: T + 7 * MIN })).toBe(t);
  });
  it('an end while paused counts the take to the moment it paused, and clears the pause', () => {
    const t = run([{ type: 'on', now: T }, { type: 'pause', now: T + 2 * MIN }, { type: 'off', now: T + 9 * MIN }]);
    expect(t.longestMs).toBe(2 * MIN);
    expect(t.current).toBeNull();
  });
  it('a new take is not paused', () => {
    const t = run([{ type: 'on', now: T }, { type: 'pause', now: T + MIN }, { type: 'off', now: T + 2 * MIN }, { type: 'on', now: T + 20 * MIN }]);
    expect(t.current?.pausedAt).toBeNull();
  });
  it('the lines read as the page shows them', () => {
    expect(takesLine(emptyDay(T))).toBe('No takes yet today.');
    expect(takesLine({ ...emptyDay(T), count: 3, longestMs: 6 * MIN + 40_000 })).toBe('Takes today: 3. The longest ran 06:40.');
    expect(takesLine({ ...emptyDay(T), count: 1 })).toBe('Takes today: 1.');
    expect(takeClock(252_000)).toBe('04:12');
    expect(takeClock(3_725_000)).toBe('1:02:05');
  });
});

describe('takes in storage', () => {
  const good = { day: '2026-11-11', count: 3, longestMs: 400_000, current: { startedAt: T - 4 * MIN, pausedAt: null, pausedMs: 0, seenAt: T } };
  it('reads a good value back', () => {
    expect(STORAGE_KEY).toBe('wall2-onair-takes');
    expect(parseTakes(JSON.stringify(good), T)).toEqual(good);
    expect(parseTakes(JSON.stringify({ ...good, current: null }), T).current).toBeNull();
  });
  it.each([
    ['null', null],
    ['not JSON', '{'],
    ['an array', '[]'],
    ['a bad day', JSON.stringify({ ...good, day: 'today' })],
    ['a text count', JSON.stringify({ ...good, count: '3' })],
    ['a fractional count', JSON.stringify({ ...good, count: 1.5 })],
    ['a negative longest', JSON.stringify({ ...good, longestMs: -1 })],
    ['a longest over a day', JSON.stringify({ ...good, longestMs: 25 * 60 * MIN })],
    ['a current that is not an object', JSON.stringify({ ...good, current: 5 })],
    ['a start in the future', JSON.stringify({ ...good, current: { ...good.current, startedAt: T + 10 * MIN, seenAt: T + 10 * MIN } })],
    ['a last seen before the start', JSON.stringify({ ...good, current: { ...good.current, seenAt: T - 9 * MIN } })],
    ['a pause before the start', JSON.stringify({ ...good, current: { ...good.current, pausedAt: T - 10 * MIN } })],
    ['a pause in the future', JSON.stringify({ ...good, current: { ...good.current, pausedAt: T + 2 * MIN } })],
    ['a text pause', JSON.stringify({ ...good, current: { ...good.current, pausedAt: 'x' } })],
    ['a missing banked time', JSON.stringify({ ...good, current: { startedAt: T - MIN, pausedAt: null, seenAt: T } })],
  ])('%s is an empty day', (_n, raw) => {
    expect(parseTakes(raw as string | null, T)).toEqual(emptyDay(T));
  });
  it('a paused take survives a reload (the pause is written with a last-seen time that is not older)', () => {
    const paused = run([{ type: 'on', now: T }, { type: 'pause', now: T + 2 * MIN }]);
    expect(paused.current?.seenAt).toBe(T + 2 * MIN);
    const back = parseTakes(JSON.stringify(paused), T + 3 * MIN);
    expect(back.count).toBe(1);
    expect(back.current?.pausedAt).toBe(T + 2 * MIN);
    // Even a pause newer than the last-seen time a build before this one wrote.
    const older = { ...paused, current: { ...paused.current!, seenAt: T } };
    expect(parseTakes(JSON.stringify(older), T + 3 * MIN).count).toBe(1);
  });
  it('another day is an empty day, and a take still running goes on as the first of the new one', () => {
    expect(parseTakes(JSON.stringify({ ...good, current: null, day: '2026-11-10' }), T)).toEqual(emptyDay(T));
    const rolled = parseTakes(JSON.stringify({ ...good, day: '2026-11-10' }), T);
    expect(rolled.day).toBe('2026-11-11');
    expect(rolled.count).toBe(1);
    expect(rolled.current).not.toBeNull();
  });
});
