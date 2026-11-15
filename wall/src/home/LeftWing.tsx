import { useEffect, useState } from 'react';
import { reviewNow } from '../ui/reviewClock';
import { houseView, HouseLine } from './HouseLine';
import { useWeather } from '../weather/useWeather';
import { OutsideRow, outsideState } from './OutsideRow';
import { SunCurve } from './SunCurve';
import { dayCurve } from './dayCurve';
import { sunHeadline } from './sunLine';
import { useDeskHouse } from './useDesk';

/** The curve and the headline redraw once a minute; nothing here animates. */
const TICK_MS = 60_000;

/**
 * Home's left third under the clock and the date: the headline ("6 h 5 min of daylight left",
 * "Sunset in 53 min" in amber, "Sunrise at 7:15 AM tomorrow"), the day drawn as a low curve with
 * the sun's place on it, one row for the weather outside, and, once the home app's desk routes
 * answer, the house row with its room dots. On a date with no sunrise or no sunset the curve is
 * left out and the headline stands alone.
 */
export function LeftWing({ now = reviewNow ?? Date.now }: { now?: () => number }) {
  const [ms, setMs] = useState(now);
  useEffect(() => {
    const id = setInterval(() => setMs(now()), TICK_MS);
    return () => clearInterval(id);
  }, [now]);
  const { house, rooms } = useDeskHouse();
  const withHouse = houseView(house, rooms) !== null;
  const head = sunHeadline(ms);
  const curve = dayCurve(ms);
  const outside = outsideState(useWeather(), Date.now());
  // Nothing to show (no sun times, the first weather read still out, no house line): no wing at all.
  if (!head && outside.kind === 'loading' && !withHouse) return null;
  return (
    <div className={withHouse ? 'home-wing with-house' : 'home-wing'} aria-label="Sun, weather and house">
      {head && (
        <div className={head.soon ? 't2 lw-head home-blk soon' : 't2 lw-head home-blk'} aria-label="Sun">
          {head.text}
        </div>
      )}
      {curve && <SunCurve curve={curve} />}
      <OutsideRow state={outside} />
      <HouseLine />
    </div>
  );
}
