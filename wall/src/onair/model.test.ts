import { describe, expect, it } from 'vitest';
import { clampIndex, elapsedMs, formatShowTime, IDLE, isShow, markErrorText, markLine, MAX_SHOW_MS, nextLine, parseSaved, partTime, startedLine, type Part, type Saved } from './model';

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
  const running: Saved = { running: true, startedAt: NOW - 60_000, accumulatedMs: 1000, firstStartAt: NOW - 61_000, stoppedAt: null, partIndex: 2, partSinceMs: 500 };

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
    expect(parseSaved(JSON.stringify({ ...running, partIndex: 1.5 }), NOW)).toEqual(IDLE);
    expect(parseSaved(JSON.stringify({ ...running, partIndex: 40 }), NOW)).toEqual(IDLE);
    expect(parseSaved(JSON.stringify({ ...running, startedAt: NOW - MAX_SHOW_MS - 1 }), NOW)).toEqual(IDLE);
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

  it('gives a part its planned minutes, the minutes left, or a quiet over-time mark', () => {
    const p = part('Demo', 20);
    expect(partTime(p, false, 0)).toEqual({ text: '20 min', over: false });
    expect(partTime(p, true, 13 * 60_000)).toEqual({ text: '7 min left', over: false });
    expect(partTime(p, true, 19 * 60_000 + 30_000)).toEqual({ text: '1 min left', over: false });
    expect(partTime(p, true, 20 * 60_000 + 30_000)).toEqual({ text: 'on time', over: false });
    expect(partTime(p, true, 23 * 60_000)).toEqual({ text: '3 min over', over: true });
    expect(partTime(part('Open', null), false, 0)).toEqual({ text: '', over: false });
    expect(partTime(part('Open', null), true, 5 * 60_000)).toEqual({ text: '5 min in', over: false });
  });

  it('names the next part and its minutes', () => {
    const parts = [part('A', 5), part('B', 15), part('C', null)];
    expect(nextLine(parts, 0)).toBe('Next: B, 15 min');
    expect(nextLine(parts, 1)).toBe('Next: C');
    expect(nextLine(parts, 2)).toBe('This is the last part');
    expect(nextLine([], 0)).toBe('No parts yet');
  });

  it('holds the part index to the parts there are', () => {
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(4, 0)).toBe(0);
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
