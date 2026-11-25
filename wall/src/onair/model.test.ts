import { describe, expect, it } from 'vitest';
import { atLimit, elapsedMs, formatShowTime, IDLE, isShow, markErrorText, markLine, MAX_SHOW_MS, parseSaved, startedLine, type Part, type Saved } from './model';

const NOW = Date.parse('2026-11-13T10:24:00-08:00');
const part = (name: string, minutes: number | null, notes: string[] = []): Part => ({ name, minutes, notes });

describe('show time', () => {
  it('is mm:ss up to 59:59, then h:mm:ss', () => {
    expect(formatShowTime(0)).toBe('00:00');
    expect(formatShowTime(999)).toBe('00:00');
    expect(formatShowTime(42 * 60_000 + 13_000)).toBe('42:13');
    expect(formatShowTime(3_599_999)).toBe('59:59');
    expect(formatShowTime(3_600_000)).toBe('1:00:00');
    expect(formatShowTime(3_600_000 + 2 * 60_000 + 5_000)).toBe('1:02:05');
    expect(formatShowTime(-5)).toBe('00:00');
  });

  it('adds the running stretch to the banked time, never past a day', () => {
    expect(elapsedMs({ running: false, startedAt: null, accumulatedMs: 5000 }, NOW)).toBe(5000);
    expect(elapsedMs({ running: true, startedAt: NOW - 2000, accumulatedMs: 5000 }, NOW)).toBe(7000);
    expect(elapsedMs({ running: true, startedAt: NOW + 2000, accumulatedMs: 5000 }, NOW)).toBe(5000);
    expect(elapsedMs({ running: true, startedAt: 1, accumulatedMs: 0 }, NOW)).toBe(MAX_SHOW_MS);
  });
});

describe('the saved timer', () => {
  const running: Saved = { running: true, startedAt: NOW - 60_000, accumulatedMs: 1000, firstStartAt: NOW - 61_000, stoppedAt: null };

  it('comes back as it was saved, so a running timer keeps counting across a restart', () => {
    const back = parseSaved(JSON.stringify(running), NOW);
    expect(back).toEqual(running);
    expect(elapsedMs(back, NOW + 10_000)).toBe(71_000);
  });

  it('is idle when missing, broken or out of range', () => {
    expect(parseSaved(null, NOW)).toEqual(IDLE);
    expect(parseSaved('not json', NOW)).toEqual(IDLE);
    expect(parseSaved('null', NOW)).toEqual(IDLE);
    expect(parseSaved(JSON.stringify({ ...running, running: 'yes' }), NOW)).toEqual(IDLE);
    expect(parseSaved(JSON.stringify({ ...running, startedAt: null }), NOW)).toEqual(IDLE);
    expect(parseSaved(JSON.stringify({ ...running, startedAt: NOW + 3_600_000 }), NOW)).toEqual(IDLE);
    expect(parseSaved(JSON.stringify({ ...running, accumulatedMs: -1 }), NOW)).toEqual(IDLE);
  });

  it('loads state saved by older versions that held a part index, whatever its value, and drops those fields', () => {
    for (const old of [{ partIndex: 2, partSinceMs: 500 }, { partIndex: 1.5, partSinceMs: -4 }, { partIndex: 99 }, { partIndex: 'x' }]) {
      const back = parseSaved(JSON.stringify({ ...running, ...old }), NOW);
      expect(back).toEqual(running);
      expect(back).not.toHaveProperty('partIndex');
      expect(back).not.toHaveProperty('partSinceMs');
    }
  });

  it('refuses a running start in the future, past two seconds of clock jitter', () => {
    expect(parseSaved(JSON.stringify({ ...running, startedAt: NOW + 5000 }), NOW)).toEqual(IDLE);
    expect(parseSaved(JSON.stringify({ ...running, startedAt: NOW + 50_000 }), NOW)).toEqual(IDLE);
    const near = parseSaved(JSON.stringify({ ...running, startedAt: NOW + 1500 }), NOW);
    expect(near.running).toBe(true);
    expect(elapsedMs(near, NOW)).toBe(1000);
  });

  it('brings a timer that ran past 24 hours while stored back as stopped at 24 hours', () => {
    const old = parseSaved(JSON.stringify({ ...running, startedAt: NOW - MAX_SHOW_MS - 1, accumulatedMs: 0 }), NOW);
    expect(old).toMatchObject({ running: false, startedAt: null, accumulatedMs: MAX_SHOW_MS, stoppedAt: NOW - 1 });
    expect(atLimit(old)).toBe(true);
    expect(startedLine(old, NOW)).toMatch(/^Stopped at 24 hours\./);
    // Banked time counts: the stretch ends when the total reaches a day.
    const banked = parseSaved(JSON.stringify({ ...running, startedAt: NOW - 3_600_000, accumulatedMs: MAX_SHOW_MS - 60_000 }), NOW);
    expect(banked).toMatchObject({ running: false, accumulatedMs: MAX_SHOW_MS, stoppedAt: NOW - 3_600_000 + 60_000 });
    // Just under a day still runs.
    expect(parseSaved(JSON.stringify({ ...running, startedAt: NOW - MAX_SHOW_MS + 5000, accumulatedMs: 0 }), NOW).running).toBe(true);
    // A stopped timer at exactly 24 hours is the same state, and Reset clears it.
    expect(atLimit(parseSaved(JSON.stringify({ ...IDLE, accumulatedMs: MAX_SHOW_MS }), NOW))).toBe(true);
    expect(atLimit(IDLE)).toBe(false);
  });

  it('drops a stop time while running', () => {
    expect(parseSaved(JSON.stringify({ ...running, stoppedAt: NOW - 5 }), NOW).stoppedAt).toBeNull();
  });
});

describe('words', () => {
  it('says how the timer started and that no stream service is connected', () => {
    expect(startedLine(IDLE, NOW)).toBe('Not started. Start it when the show begins. No stream service connected.');
    const started = Date.parse('2026-11-13T09:42:00-08:00');
    const on: Saved = { ...IDLE, running: true, startedAt: started, firstStartAt: started };
    expect(startedLine(on, NOW)).toMatch(/^Started \d{1,2}:42 [AP]M by hand\. No stream service connected\.$/);
    const off: Saved = { ...IDLE, accumulatedMs: 1000, firstStartAt: started, stoppedAt: NOW };
    expect(startedLine(off, NOW)).toMatch(/^Started \d{1,2}:42 [AP]M by hand, stopped at \d{1,2}:24 [AP]M\. No stream service connected\.$/);
  });

  it('says today\'s marks and why a mark was refused', () => {
    expect(markLine(null)).toBe('Saved to marks.txt');
    expect(markLine({ today: 0, last: [] })).toBe('None yet today. Saved to marks.txt');
    expect(markLine({ today: 2, last: ['03:12', '09:40'] })).toBe('2 marked: 03:12, 09:40. Saved to marks.txt');
    expect(markErrorText('refused')).toBe('marks.txt is full; move it aside');
    expect(markErrorText('not-configured')).toBe('No config folder on this PC');
    expect(markErrorText(new Error('x'))).toBe('Could not write marks.txt');
  });

  it('checks a run-of-show answer before using it', () => {
    expect(isShow({ state: 'ok', title: null, parts: [part('A', 5, ['n'])], skipped: 0, reason: null, readAt: 1 })).toBe(true);
    expect(isShow({ state: 'other', parts: [] })).toBe(false);
    expect(isShow({ state: 'ok', parts: [{ name: 3, notes: [] }] })).toBe(false);
    expect(isShow('## A')).toBe(false);
  });
});
