import { useDayFeed } from '../ribbon/useDayEvents';
import { useVisible } from '../ui/useVisible';
import { firstTomorrow, tomorrowTime } from './model';
import type { DayEvent } from '../ribbon/model';

/** Cached calendar data older than this is not shown at all. */
export const TOMORROW_STALE_MS = 30 * 60_000;

/** "9:41 PM" for the "as of" note. */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** What tomorrow's spot says: the first event (with the time of the last good read when it is cached), that the calendar cannot be read, or nothing. */
export type TomorrowView = { kind: 'event'; first: DayEvent; asOf: number | null } | { kind: 'unavailable' } | null;

/**
 * Tomorrow's first event from the calendar day feed, with the honesty rules in one place (Unwind and Dream both read it):
 * cached data after a failed refresh carries its read time for up to 30 minutes, then hides; when no account can be
 * read, or the cached data is too old, the view says the calendar is not available; clear days and "not set up" say nothing.
 */
export function useTomorrow(now: () => number = Date.now, wallNow: () => number = Date.now): TomorrowView {
  const visible = useVisible();
  const feed = useDayFeed(visible);
  const first = firstTomorrow(feed.events, now());
  const stale = feed.failedAt !== null && feed.at !== null;
  const tooOld = stale && wallNow() - feed.at! > TOMORROW_STALE_MS;
  if (feed.calendar === 'unavailable' || (feed.failedAt !== null && (!first || tooOld))) return { kind: 'unavailable' };
  if (!first || tooOld) return null;
  return { kind: 'event', first, asOf: stale ? feed.at : null };
}

/**
 * "Tomorrow: First thing: AE sync at 9:00" from the calendar day feed. Nothing when
 * tomorrow is clear or Meet is not set up. After a failed refresh the cached event shows
 * with "as of H:MM" for up to 30 minutes from the last good read, then the spot says
 * "Calendar not available" (never an empty hole).
 */
export function Tomorrow({ now = Date.now, wallNow = Date.now }: { now?: () => number; wallNow?: () => number }) {
  const t = useTomorrow(now, wallNow);
  if (!t) return null;
  if (t.kind === 'unavailable') {
    return (
      <div className="u-blk u-tomorrow">
        <span className="u-k">Tomorrow</span>
        <div className="u-s u-asof">Calendar not available</div>
      </div>
    );
  }
  return (
    <div className="u-blk u-tomorrow">
      <span className="u-k">Tomorrow</span>
      <div className="u-s u-ell">
        First thing: {t.first.title} at {tomorrowTime(Date.parse(t.first.start))}
        {t.asOf !== null ? <span className="u-asof"> as of {clockTime(t.asOf)}</span> : null}
      </div>
    </div>
  );
}
