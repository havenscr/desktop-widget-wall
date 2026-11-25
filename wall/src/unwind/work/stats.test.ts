import { describe, expect, it } from 'vitest';
import type { Meeting } from '../../meet/model';
import { durationText, focusToday, meetingsLeft } from './stats';

const at = (h: number, m = 0) => new Date(2026, 10, 25, h, m).getTime();
const meet = (key: string, from: number, to: number): Meeting => ({ key, accountId: 'a', title: key, start: new Date(from).toISOString(), end: new Date(to).toISOString(), canJoin: true });

describe('Next up stats', () => {
  it('counts focus minutes today, an open session up to now and yesterday not at all', () => {
    const now = at(12);
    expect(focusToday([{ start: at(9), end: at(10, 30) }, { start: at(11, 30), end: at(13) }], now)).toBe(120);
    expect(focusToday([{ start: at(0) - 3600_000, end: at(0) + 600_000 }], now)).toBe(10);
    expect(focusToday([{ start: at(0) - 7200_000, end: at(0) - 3600_000 }], now)).toBe(0);
  });
  it('writes minutes as hours and minutes', () => {
    expect(durationText(190)).toBe('3 h 10 m');
    expect(durationText(45)).toBe('45 m');
    expect(durationText(0)).toBe('0 m');
  });
  it('counts meetings still ahead today, without the one shown', () => {
    const now = at(12);
    const shown = meet('a', at(13), at(14));
    const list = [meet('past', at(9), at(10)), shown, meet('b', at(15), at(16)), meet('tomorrow', at(0) + 86_400_000 + 3600_000, at(0) + 86_400_000 + 7200_000)];
    expect(meetingsLeft(list, now, shown)).toBe(1);
    expect(meetingsLeft(list, now)).toBe(2);
  });
});
