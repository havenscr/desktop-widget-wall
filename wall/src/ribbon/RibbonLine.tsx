import { useMinute } from './Ribbon';
import { chips, needle } from './model';
import type { DayFeed } from './useDayEvents';

/**
 * The day as one thin line, for a place that has no ribbon at rest (Unwind): today's meetings as short bars on a
 * 4 px line over the ribbon's own x scale, and a dot at the time. Nothing to read or press; the full ribbon fades in
 * over it when the work layer comes up.
 */
export function RibbonLine({ feed, now = Date.now }: { feed: DayFeed; now?: () => number }) {
  const t = useMinute(now);
  const day = feed;
  const n = needle(t);
  return (
    <div className="rib-line" aria-hidden="true" data-testid="rib-line">
      {chips(day.events, t).map((c) => (
        <i key={c.key} className="rl-ev" data-state={c.state} style={{ left: c.x, width: Math.max(4, c.width) }} />
      ))}
      <b className="rl-now" style={{ left: n.x }} />
    </div>
  );
}
