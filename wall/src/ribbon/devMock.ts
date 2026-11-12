import { isTauri } from '../bridge/tauri';
import { dayKey, FOCUS_DAY_KEY, parseDay, serializeDay } from '../focus/day';
import { localMidnight } from './sun';

/**
 * Dev server only. A review still (`?hz=&at=`) gets the concept's two focus sessions
 * (10:00 to 10:45 and 12:45 to 2:00 PM) on the review's day if none are saved for it,
 * so the ribbon's focus bar shows. The calendar comes from `bridge/devMocks/meet.ts`.
 */
export function seedReviewFocus(reviewMs: number | null): void {
  if (isTauri() || reviewMs === null) return;
  try {
    const saved = parseDay(localStorage.getItem(FOCUS_DAY_KEY));
    if (saved.some((s) => dayKey(s.start) === dayKey(reviewMs))) return;
    const hour = (h: number) => localMidnight(reviewMs) + h * 3_600_000;
    localStorage.setItem(FOCUS_DAY_KEY, serializeDay([{ start: hour(10), end: hour(10.75) }, { start: hour(12.75), end: hour(14) }]));
  } catch {
    /* no storage: no focus bars */
  }
}
