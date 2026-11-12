import { useEffect, useState } from 'react';
import { SheepSvg } from '../buddy/Watt';
import { SPRITES, SPRITE_PX } from '../buddy/sprites';
import { formatClock } from '../clock/format';

/** Where Watt sleeps, in stage pixels (left edge and ground line). */
export const DREAM_SHEEP = { x: 1226, base: 688 } as const;

const systemNow = () => new Date();

/**
 * Dream: the breathing guide is gone, flames are dimmed (by `Flames`), a small clock, and Watt
 * asleep in the corner with z's drifting up. A tap anywhere wakes back to Zen.
 */
export function Dream({ onWake, now = systemNow }: { onWake: () => void; now?: () => Date }) {
  const [parts, setParts] = useState(() => formatClock(now()));
  useEffect(() => {
    const id = window.setInterval(() => setParts(formatClock(now())), 15_000);
    return () => window.clearInterval(id);
  }, [now]);
  const h = SPRITES.sleep.length * SPRITE_PX;
  return (
    <div className="dream" role="button" tabIndex={0} aria-label="Wake" onClick={onWake} onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onWake();
        }
      }}>
      <div className="dream-clock">
        {parts.time}
        <small>{parts.meridiem}</small>
      </div>
      <div className="dream-hint">Touch anywhere to wake</div>
      <div className="dream-watt" aria-hidden="true" style={{ left: DREAM_SHEEP.x, top: DREAM_SHEEP.base - h }}>
        <div className="dream-bob">
          <SheepSvg pose="sleep" />
        </div>
        <span className="dream-z">z</span>
        <span className="dream-z sm">z</span>
      </div>
    </div>
  );
}
