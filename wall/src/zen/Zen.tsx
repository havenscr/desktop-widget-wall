import { useCallback, useEffect, useRef, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { usePlaceStore } from '../state/places';
import { Breath } from './Breath';
import { Dream } from './Dream';
import { Flames } from './Flames';
import { isDreamTime, sessionSecondsLeft, type SessionMinutes } from './model';

const NIGHT_CHECK_MS = 30_000;
/** The guide fades out over this long before Dream shows. */
export const GUIDE_FADE_MS = 1200;

export interface ZenProps {
  /** Wall clock in ms; inject in tests. */
  nowMs?: () => number;
}

/**
 * The Zen place: a full-stage view over everything else. Flames, a breathing guide and a short
 * timed session. When a session ends, or when Zen is open at night (9:30 PM to 6:30 AM), it falls
 * into Dream; a tap wakes it. Separate from the focus timer and from Do Not Disturb.
 */
export function Zen({ nowMs = Date.now }: ZenProps) {
  const [dream, setDream] = useState(() => isDreamTime(new Date(nowMs())));
  const [minutes, setMinutes] = useState<SessionMinutes>(5);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Set when a tap woke Zen at night, so the night rule does not put it straight back to sleep.
  const woke = useRef(false);
  const [ending, setEnding] = useState(false);

  const start = useCallback(() => setStartedAt(nowMs()), [nowMs]);
  const stop = useCallback(() => setStartedAt(null), []);
  const wake = useCallback(() => {
    woke.current = true;
    setEnding(false);
    setStartedAt(null);
    setDream(false);
  }, []);

  // Session end: the guide fades out and the view goes to Dream.
  useEffect(() => {
    if (startedAt === null || ending) return;
    const id = window.setInterval(() => {
      if (sessionSecondsLeft(startedAt, minutes, nowMs()) <= 0) {
        // The running state (0:00 left, Stop disabled) stays until the guide has faded out.
        setEnding(true);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [startedAt, minutes, ending, nowMs]);

  // The fade finishes, then Dream.
  useEffect(() => {
    if (!ending) return;
    const id = window.setTimeout(() => {
      setEnding(false);
      setStartedAt(null);
      setDream(true);
    }, GUIDE_FADE_MS);
    return () => window.clearTimeout(id);
  }, [ending]);

  // Night starting while Zen is open.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!woke.current && startedAt === null && !ending && isDreamTime(new Date(nowMs()))) setDream(true);
    }, NIGHT_CHECK_MS);
    return () => window.clearInterval(id);
  }, [startedAt, ending, nowMs]);

  // Zen covers the rail, so keep keyboard focus inside it (Start, or the Dream surface).
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('button:not(:disabled), [role="button"]')?.focus();
  }, [dream]);

  return (
    <section ref={root} className={`zen${dream ? ' is-dream' : ''}`} data-place="zen" aria-label="Zen">
      <Flames dim={dream} />
      {dream ? (
        <Dream onWake={wake} now={() => new Date(nowMs())} />
      ) : (
        <div className={`zen-guide${ending ? ' ending' : ''}`}>
          <Breath minutes={minutes} onMinutes={setMinutes} startedAt={startedAt} onStart={start} onStop={stop} ending={ending} now={nowMs} />
          <button
            type="button"
            className="zbtn zleave"
            aria-label="Leave Zen"
            onClick={() => usePlaceStore.getState().setActive(usePlaceStore.getState().from)}
          >
            <IconX size={26} aria-hidden="true" />
            Leave
          </button>
        </div>
      )}
    </section>
  );
}
