import { useEffect, useState } from 'react';
import { reviewNow } from '../ui/reviewClock';
import { sunLine } from './sunLine';

const TICK_MS = 30_000;

/**
 * Home's left wing under the clock: the sun block ("Sunset in 4 min" and a line). The
 * House line (inside temperature, rooms with lights on) joins it once the home app
 * reads land (PR 24).
 */
export function LeftWing({ now = reviewNow ?? Date.now }: { now?: () => number }) {
  const [ms, setMs] = useState(now);
  useEffect(() => {
    const id = setInterval(() => setMs(now()), TICK_MS);
    return () => clearInterval(id);
  }, [now]);
  const line = sunLine(ms);
  if (!line) return null;
  return (
    <div className="home-wing" aria-label="Sun">
      <div className="home-blk">
        <span className={line.soon ? 'k soon' : 'k'}>{line.key}</span>
        <div className="t2">{line.text}</div>
      </div>
    </div>
  );
}
