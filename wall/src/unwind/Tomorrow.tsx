import { useDayEvents } from '../ribbon/useDayEvents';
import { useVisible } from '../ui/useVisible';
import { firstTomorrow, tomorrowTime } from './model';

/** "Tomorrow: First thing: AE sync at 9:00" from the calendar day feed. Nothing when tomorrow morning is clear or Meet is not set up. */
export function Tomorrow({ now = Date.now }: { now?: () => number }) {
  const visible = useVisible();
  const events = useDayEvents(visible);
  const first = firstTomorrow(events, now());
  if (!first) return null;
  return (
    <div className="u-blk u-tomorrow">
      <span className="u-k">Tomorrow</span>
      <div className="u-s u-ell">
        First thing: {first.title} at {tomorrowTime(Date.parse(first.start))}
      </div>
    </div>
  );
}
