import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../ui/useReducedMotion';
import { DEFAULT_PATTERN, NUM_FONT_PX, RING_BASE_PX, SCALE_MIN, SCALE_SPAN, WORD_FONT_PX, WORD_NUM_GAP_PX, breathAt, type BreathPattern } from './model';

export interface BreathProps {
  /** Start time (ms) of the running session, or null when none runs. The cycle restarts at "Breathe in" on a new start. */
  startedAt: number | null;
  now?: () => number;
  /** Phase lengths (in, hold, out, hold); default calm 4-2-6. A new pattern restarts the cycle. */
  pattern?: BreathPattern;
}

/**
 * The breathing guide on the pattern's cycle (12 seconds for the calm default): a thin gradient ring that grows and shrinks, a faint fixed
 * guide ring at the full inhale size, a soft glow (a sibling of the masked ring, scaled with it) that brightens on the inhale, and the phase
 * word with the seconds left in the centre. The words keep one fixed size, small enough to sit inside
 * the ring at its smallest (see `minRingDiameter`).
 */
export function Breath({ startedAt, now = Date.now, pattern = DEFAULT_PATTERN }: BreathProps) {
  const circle = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const [origin] = useState(() => ({ ms: startedAt ?? now() }));
  const [view, setView] = useState(() => breathAt(0, pattern));

  useEffect(() => {
    if (startedAt !== null) origin.ms = startedAt;
  }, [startedAt, origin]);
  // Another pattern starts its own cycle from "Breathe in" (only before a session runs; a running one keeps its start).
  useEffect(() => {
    if (startedAt === null) origin.ms = now();
  }, [pattern, startedAt, now, origin]);

  const reduced = useReducedMotion();

  useEffect(() => {
    const apply = (scale: number, glowOpacity: number) => {
      const t = `scale(${scale.toFixed(3)})`;
      if (circle.current) circle.current.style.transform = t;
      if (glow.current) {
        glow.current.style.transform = t;
        glow.current.style.opacity = glowOpacity.toFixed(3);
      }
    };
    const phase = () => breathAt((now() - origin.ms) / 1000, pattern);
    const show = (b: ReturnType<typeof breathAt>) => setView((prev) => (prev.word === b.word && prev.left === b.left ? prev : b));
    if (reduced) {
      // Reduced motion: the ring and glow hold a steady mid state; only the word and seconds change, once a second.
      apply(SCALE_MIN + SCALE_SPAN / 2, 0.6);
      show(phase());
      const id = window.setInterval(() => show(phase()), 1000);
      return () => window.clearInterval(id);
    }
    let raf = 0;
    const tick = () => {
      const b = phase();
      apply(b.scale, 0.25 + 0.75 * ((b.scale - SCALE_MIN) / SCALE_SPAN));
      show(b);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [now, origin, reduced, pattern]);

  const size = { width: RING_BASE_PX, height: RING_BASE_PX, margin: `${-RING_BASE_PX / 2}px 0 0 ${-RING_BASE_PX / 2}px` };
  return (
    <div className="breath">
      <div className="breath-guide" style={{ ...size, transform: `scale(${SCALE_MIN + SCALE_SPAN})` }} aria-hidden="true" />
      <div className="breath-ring" style={size}>
        <div className="breath-glow" ref={glow} aria-hidden="true" />
        <div className="breath-circle" ref={circle} aria-hidden="true" />
        <div className="breath-words" role="status" aria-live="off">
          <div className="breath-word" style={{ fontSize: WORD_FONT_PX }}>
            {view.word}
          </div>
          <div className="breath-num" style={{ fontSize: NUM_FONT_PX, marginTop: WORD_NUM_GAP_PX }}>
            {view.left}
          </div>
        </div>
      </div>
    </div>
  );
}
