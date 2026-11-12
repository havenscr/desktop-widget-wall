import { isTauri, mocks } from '../bridge/tauri';
import { dayKey, FOCUS_DAY_KEY, parseDay, serializeDay } from '../focus/day';
import { localMidnight } from './sun';

/**
 * Dev server only: the concept's day for the ribbon (AE sync, a call, Forum and a
 * livestream). It fills `wall2_meet_day` when no other mock has, and always in a review
 * still (`?hz=&at=`), where it is placed on the review's day. A review still also gets
 * the concept's two focus sessions on that day if none are saved for it.
 */
export function registerRibbonMocks(reviewMs: number | null): void {
  if (isTauri()) return;
  if (reviewMs === null && mocks.has('wall2_meet_day')) return;
  const base = () => localMidnight(reviewMs ?? Date.now());
  const at = (base0: number, h: number) => new Date(base0 + h * 3_600_000).toISOString().replace('.000Z', 'Z');
  mocks.set('wall2_meet_day', () => {
    const b = base();
    const ev = (key: string, title: string, s: number, e: number, isLive = false) => ({
      key,
      accountId: 'work',
      title,
      start: at(b, s),
      end: at(b, e),
      canJoin: !isLive,
      isLive,
    });
    return {
      accounts: [{ id: 'work', label: 'Work', state: 'ok' }],
      events: [
        ev('d1-0', 'AE sync', 9, 9.75),
        ev('d1-1', 'Call', 12, 12.42),
        ev('d1-2', 'Forum', 15, 16.25),
        ev('d1-3', 'Livestream: Fabric Apps', 18.5, 20.5, true),
      ],
    };
  });
  if (reviewMs === null) return;
  try {
    const saved = parseDay(localStorage.getItem(FOCUS_DAY_KEY));
    if (saved.some((s) => dayKey(s.start) === dayKey(reviewMs))) return;
    const b = base();
    const hour = (h: number) => b + h * 3_600_000;
    localStorage.setItem(FOCUS_DAY_KEY, serializeDay([{ start: hour(10), end: hour(10.75) }, { start: hour(12.75), end: hour(14) }]));
  } catch {
    /* no storage: no focus bars */
  }
}
