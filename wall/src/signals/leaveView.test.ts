import { describe, expect, it } from 'vitest';
import { AMBER_MS, bannerView, inNowWindow, LEAD_MS, NOW_MS, plainTitle } from './leaveView';

const MIN = 60_000;
const startsAt = new Date(2026, 10, 12, 10, 45).getTime();
const leaveAt = startsAt - 30 * MIN;
const leave = { key: 'k', leaveAt, startsAt };

describe('plainTitle', () => {
  it('drops the start clock in parentheses and keeps the rest', () => {
    expect(plainTitle("Doctor's appointment (10:45 start)")).toBe("Doctor's appointment");
    expect(plainTitle('Trip (start 10:45) to the coast')).toBe('Trip to the coast');
    expect(plainTitle('Review (draft) (10:45 starts)')).toBe('Review (draft)');
  });
  it('names an empty title', () => {
    expect(plainTitle('(10:45 start)')).toBe('Your appointment');
  });
});

describe('bannerView', () => {
  it('shows nothing before 30 minutes ahead', () => {
    expect(bannerView(leave, 'A (10:45 start)', leaveAt - LEAD_MS - 1)).toBeNull();
  });
  it('shows the quiet banner from 30 minutes ahead, with the minutes rounded up', () => {
    const v = bannerView(leave, "Doctor's appointment (10:45 start)", leaveAt - 25 * MIN)!;
    expect(v.phase).toBe('lead');
    expect(v.lead).toBe('Leave in 25 min.');
    expect(v.rest).toBe("Doctor's appointment starts 10:45");
    expect(bannerView(leave, 'A', leaveAt - LEAD_MS)!.lead).toBe('Leave in 30 min.');
    expect(bannerView(leave, 'A', leaveAt - 12 * MIN - 1)!.lead).toBe('Leave in 13 min.');
  });
  it('turns amber at exactly 5 minutes and under', () => {
    expect(bannerView(leave, 'A', leaveAt - AMBER_MS - 1)!.phase).toBe('lead');
    const v = bannerView(leave, 'A', leaveAt - AMBER_MS)!;
    expect(v.phase).toBe('amber');
    expect(v.lead).toBe('Leave in 5 min.');
    expect(bannerView(leave, 'A', leaveAt - 10_000)!.lead).toBe('Leave in 1 min.');
  });
  it('reads "Leave now." from the leave time until 10 minutes later', () => {
    expect(bannerView(leave, 'A', leaveAt)!.lead).toBe('Leave now.');
    expect(bannerView(leave, 'A', leaveAt)!.phase).toBe('now');
    expect(bannerView(leave, 'A', leaveAt + NOW_MS - 1)!.lead).toBe('Leave now.');
    expect(bannerView(leave, 'A', leaveAt + NOW_MS)).toBeNull();
  });
  it('ends at the real start when that comes before the 10 minutes', () => {
    const soon = { key: 'k', leaveAt, startsAt: leaveAt + 4 * MIN };
    expect(bannerView(soon, 'A', leaveAt + 4 * MIN - 1)).not.toBeNull();
    expect(bannerView(soon, 'A', leaveAt + 4 * MIN)).toBeNull();
    expect(inNowWindow(soon, leaveAt + 4 * MIN - 1)).toBe(true);
    expect(inNowWindow(soon, leaveAt + 4 * MIN)).toBe(false);
  });
  it('the hover card gives the block time and the real start', () => {
    const tip = bannerView(leave, 'A (10:45 start)', leaveAt)!.tip;
    expect(tip).toContain('Leave at 10:15 AM.');
    expect(tip).toContain('A starts at 10:45 AM');
    expect(tip).toContain('Click to open the event');
  });
  it('refuses a signal with a bad time', () => {
    expect(bannerView({ key: 'k', leaveAt: Number.NaN, startsAt }, 'A', leaveAt)).toBeNull();
  });
});
