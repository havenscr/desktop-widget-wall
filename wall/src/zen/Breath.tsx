import { useEffect, useRef, useState } from 'react';
import { IconPlayerPlayFilled, IconPlayerStopFilled } from '@tabler/icons-react';
import { SESSION_MINUTES, breathAt, formatLeft, sessionSecondsLeft, type SessionMinutes } from './model';

export interface BreathProps {
  /** Minutes picked for the next session. */
  minutes: SessionMinutes;
  onMinutes: (m: SessionMinutes) => void;
  /** Start time (ms) of the running session, or null when none runs. */
  startedAt: number | null;
  onStart: () => void;
  onStop: () => void;
  now?: () => number;
}

/**
 * The breathing guide: a large soft circle on a 12 second cycle, the phase word and the seconds
 * left in the phase, centred; a length picker and Start or Stop below. The cycle restarts at
 * "Breathe in" whenever a session starts.
 */
export function Breath({ minutes, onMinutes, startedAt, onStart, onStop, now = Date.now }: BreathProps) {
  const circle = useRef<HTMLDivElement>(null);
  const [origin] = useState(() => ({ ms: startedAt ?? now() }));
  const [view, setView] = useState(() => breathAt(0));
  const [left, setLeft] = useState(() => (startedAt === null ? null : sessionSecondsLeft(startedAt, minutes, now())));
  const startedRef = useRef(startedAt);
  startedRef.current = startedAt;
  const minutesRef = useRef(minutes);
  minutesRef.current = minutes;

  // A new session restarts the cycle at "Breathe in".
  useEffect(() => {
    if (startedAt !== null) origin.ms = startedAt;
  }, [startedAt, origin]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = now();
      const b = breathAt((t - origin.ms) / 1000);
      if (circle.current) circle.current.style.transform = `scale(${b.scale.toFixed(3)})`;
      setView((prev) => (prev.word === b.word && prev.left === b.left ? prev : b));
      const s = startedRef.current;
      const l = s === null ? null : sessionSecondsLeft(s, minutesRef.current, t);
      setLeft((prev) => (prev === l ? prev : l));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [now, origin]);

  const running = startedAt !== null;
  return (
    <div className="breath">
      <div className="breath-ring">
        <div className="breath-circle" ref={circle} aria-hidden="true" />
        <div className="breath-words" role="status" aria-live="off">
          <div className="breath-word">{view.word}</div>
          <div className="breath-num">{view.left}</div>
        </div>
      </div>
      <div className="breath-controls">
        {running ? (
          <div className="breath-left" aria-label="Time left in the session">
            {formatLeft(left ?? 0)}
          </div>
        ) : (
          <div className="breath-picker" role="radiogroup" aria-label="Session length">
            {SESSION_MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={m === minutes}
                className="zbtn"
                onClick={() => onMinutes(m)}
              >
                {m} min
              </button>
            ))}
          </div>
        )}
        {running ? (
          <button type="button" className="zbtn go" onClick={onStop}>
            <IconPlayerStopFilled size={28} aria-hidden="true" />
            Stop
          </button>
        ) : (
          <button type="button" className="zbtn go" onClick={onStart}>
            <IconPlayerPlayFilled size={28} aria-hidden="true" />
            Start
          </button>
        )}
      </div>
    </div>
  );
}
