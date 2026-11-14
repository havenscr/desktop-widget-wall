import { useEffect, useState } from 'react';
import { reviewNow } from '../ui/reviewClock';
import { HouseLine, houseView } from './HouseLine';
import { sunLine } from './sunLine';
import { useDeskHouse } from './useDesk';

const TICK_MS = 30_000;

/**
 * Home's left wing under the clock: the sun block ("Sunset in 4 min" and a line) and, once
 * the home app's desk routes answer, the house line under it. With the house line the sun
 * block moves up under the date, as the concept draws it; without it, it stays where it was.
 */
export function LeftWing({ now = reviewNow ?? Date.now }: { now?: () => number }) {
  const [ms, setMs] = useState(now);
  useEffect(() => {
    const id = setInterval(() => setMs(now()), TICK_MS);
    return () => clearInterval(id);
  }, [now]);
  const { house, rooms } = useDeskHouse();
  const withHouse = houseView(house, rooms) !== null;
  const line = sunLine(ms);
  if (!line && !withHouse) return null;
  return (
    <div className={withHouse ? 'home-wing with-house' : 'home-wing'} aria-label="Sun and house">
      {line && (
        <div className="home-blk" aria-label="Sun">
          <span className={line.soon ? 'k soon' : 'k'}>{line.key}</span>
          <div className="t2">{line.text}</div>
        </div>
      )}
      <HouseLine />
    </div>
  );
}
