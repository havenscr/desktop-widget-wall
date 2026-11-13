import { useRef } from 'react';
import { useMeetingFeed } from '../work/useNextMeeting';
import { useLeaveDismissed } from './leaveDismiss';
import { bannerView, inNowWindow, type BannerView, type TitledLeave } from './leaveView';
import { useSignalStore } from './store';
import { useClock } from './useClock';

/** How often the banner re-reads the clock (it shows whole minutes). */
export const BANNER_TICK_MS = 5_000;

export interface ShownLeave { leave: TitledLeave; view: BannerView }

/**
 * What the leave banner shows now, or null. Never while the signals are unknown or the meeting
 * list is stale or failed; never for a dismissed event. The signal store drops an event once its
 * leave time has passed, so the banner holds the last one for its "Leave now" window (while the
 * meeting is still in the list, so a cancelled one goes at once).
 */
export function useLeaveBanner(): ShownLeave | null {
  const known = useSignalStore((s) => s.known);
  const signal = useSignalStore((s) => s.leave) as TitledLeave | null;
  const feed = useMeetingFeed();
  const dismissed = useLeaveDismissed((s) => s.entries);
  const now = useClock(BANNER_TICK_MS);
  const held = useRef<TitledLeave | null>(null);

  const bad = !known || feed.feedStale || feed.failed;
  if (bad) held.current = null;
  else {
    const h = held.current;
    // The event in its "Leave now" window keeps the banner over a later one.
    if (signal && !(h && h.key !== signal.key && inNowWindow(h, now))) held.current = signal;
    else if (!signal && h && !inNowWindow(h, now) && h.leaveAt <= now) held.current = null;
  }
  if (bad) return null;

  const h = held.current;
  const leave = h && inNowWindow(h, now) && (h.title !== undefined || feed.meetings.some((m) => m.key === h.key)) ? h : signal;
  if (!leave || dismissed.some((e) => e.key === leave.key && e.until > now)) return null;
  const title = leave.title ?? feed.meetings.find((m) => m.key === leave.key)?.title ?? '';
  const view = bannerView(leave, title, now);
  return view ? { leave, view } : null;
}
