import { describe, expect, it } from 'vitest';
import { formatBuild, formatClock } from './format';

describe('formatClock', () => {
  it('formats morning', () => {
    expect(formatClock(new Date(2026, 10, 11, 9, 5))).toEqual({
      time: '9:05',
      meridiem: 'AM',
      date: 'Wednesday, November 11',
    });
  });
  it('formats noon', () => {
    const p = formatClock(new Date(2026, 10, 11, 12, 0));
    expect(p.time).toBe('12:00');
    expect(p.meridiem).toBe('PM');
  });
  it('formats midnight', () => {
    const p = formatClock(new Date(2026, 10, 11, 0, 30));
    expect(p.time).toBe('12:30');
    expect(p.meridiem).toBe('AM');
  });
});

describe('formatBuild', () => {
  it('gives the commit and a local date and time', () => {
    const line = formatBuild({ commit: '7c9f442', builtAt: '2026-11-13T09:05Z' });
    expect(line).toMatch(/^Build 7c9f442, Nov 1[23], \d{1,2}:05 (AM|PM)$/);
  });
  it('accepts the dev stamp and drops odd input', () => {
    expect(formatBuild({ commit: 'dev', builtAt: '2026-11-13T09:05Z' })).toBe('Build dev (local)');
    expect(formatBuild({ commit: 'nope!', builtAt: 'x' })).toBeNull();
    expect(formatBuild(null)).toBeNull();
    expect(formatBuild({ commit: 'abcdef0', builtAt: 'garbage' })).toBe('Build abcdef0');
  });
});
