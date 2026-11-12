import { describe, expect, it } from 'vitest';
import { formatClock } from './format';

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
