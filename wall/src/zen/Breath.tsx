import { useEffect, useState } from 'react';
import { DEFAULT_PATTERN, breathAt, type BreathPattern } from './model';

export interface BreathProps {
  /** Start time (ms) of the running session, or null when none runs. The cycle restarts at "Breathe in" on a new start. */
  startedAt: number | null;
  now?: () => number;
  /** Phase lengths (in, hold, out, hold); default calm 4-2-6. A new pattern restarts the cycle. */
  pattern?: BreathPattern;
}

/**
 * The breathing words on the pattern's cycle (12 seconds for the calm default): the phase word with the seconds left
 * in the phase, over the lake. The ridge itself breathes (`zen/stage.ts`); there is no ring.
 */
export function Breath({ startedAt, now = Date.now, pattern = DEFAULT_PATTERN }: BreathProps) {
  const [origin] = useState(() => ({ ms: startedAt ?? now() }));
  const [view, setView] = useState(() => breathAt(0, pattern));

  useEffect(() => {
    if (startedAt !== null) origin.ms = startedAt;
  }, [startedAt, origin]);

  useEffect(() => {
    const show = () => {
      const b = breathAt((now() - origin.ms) / 1000, pattern);
      setView((prev) => (prev.word === b.word && prev.left === b.left ? prev : b));
    };
    show();
    const id = window.setInterval(show, 200);
    return () => window.clearInterval(id);
  }, [now, origin, pattern]);

  return (
    <div className="breath" role="status" aria-live="off">
      <div className="breath-word">{view.word}</div>
      <div className="breath-num">{view.left}</div>
    </div>
  );
}
