import { useDayFeed } from '../ribbon/useDayEvents';
import { useVisible } from '../ui/useVisible';
import { firstTomorrow, tomorrowTime } from './model';

/** Cached calendar data older than this is not shown at all. */
export const TOMORROW_STALE_MS = 30 * 60_000;

/** "9:41 PM" for the "as of" note. */
function clockTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * "Tomorrow: First thing: AE sync at 9:00" from the calendar day feed. Nothing when
 * tomorrow is clear or Meet is not set up. After a failed refresh the cached event shows
 * with "as of H:MM" for up to 30 minutes from the last good read, then hides.
 */
export function Tomorrow({ now = Date.now, wallNow = Date.now }: { now?: () => number; wallNow?: () => number }) {
  const visible = useVisible();
  const feed = useDayFeed(visible);
  const first = firstTomorrow(feed.events, now());
  if (!first) return null;
  const stale = feed.failedAt !== null && feed.at !== null;
  if (stale && wallNow() - feed.at! > TOMORROW_STALE_MS) return null;
  return (
    <div className="u-blk u-tomorrow">
      <span className="u-k">Tomorrow</span>
      <div className="u-s u-ell">
        First thing: {first.title} at {tomorrowTime(Date.parse(first.start))}
        {stale ? <span className="u-asof"> as of {clockTime(feed.at!)}</span> : null}
      </div>
    </div>
  );
}
