import { useCallback, useEffect, useRef, useState } from 'react';
import { IconPlayerPlayFilled, IconX } from '@tabler/icons-react';
import { Clock } from '../clock/Clock';
import { usePlaceStore } from '../state/places';
import { visibleRows } from '../tasks/model';
import { useTasks } from '../tasks/useTasks';
import { Breath } from './Breath';
import { Dream } from './Dream';
import { Flames } from './Flames';
import {
  SESSION_MINUTES,
  ZEN_VEIL,
  formatLeft,
  isDreamTime,
  sessionLabel,
  sessionSecondsLeft,
  waitingLines,
  type SessionMinutes,
} from './model';

const NIGHT_CHECK_MS = 30_000;
/** The guide fades out over this long before Dream shows. */
export const GUIDE_FADE_MS = 1200;

export interface ZenProps {
  /** Wall clock in ms; inject in tests. */
  nowMs?: () => number;
}

/** Seconds left in the running session, ticking twice a second. */
function useLeft(startedAt: number | null, minutes: SessionMinutes, nowMs: () => number): number {
  const [left, setLeft] = useState(() => (startedAt === null ? 0 : sessionSecondsLeft(startedAt, minutes, nowMs())));
  useEffect(() => {
    if (startedAt === null) return;
    const tick = () => setLeft(sessionSecondsLeft(startedAt, minutes, nowMs()));
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [startedAt, minutes, nowMs]);
  return left;
}

/** The open-task count, from the same feed as the Work task card. Nothing when the feed is not set up or empty. */
function Waiting() {
  const t = useTasks();
  const lines = t.status === 'unconfigured' ? null : waitingLines(visibleRows(t.tasks, t.hidden));
  if (!lines) return null;
  return (
    <div className="zen-waiting">
      <div>{lines.count}</div>
      {lines.urgent && <div>{lines.urgent}</div>}
    </div>
  );
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
  const clockNow = useCallback(() => new Date(nowMs()), [nowMs]);
  const running = startedAt !== null;
  const left = useLeft(startedAt, minutes, nowMs);

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
      <div className="zen-veil" style={{ opacity: dream ? 0 : ZEN_VEIL }} aria-hidden="true" />
      {dream ? (
        <Dream onWake={wake} now={clockNow} />
      ) : (
        <div className={`zen-guide${ending ? ' ending' : ''}`}>
          <Breath startedAt={startedAt} now={nowMs} />
          {running && !ending && (
            <div
              className="zen-tap"
              role="button"
              tabIndex={0}
              aria-label="End session early"
              onClick={stop}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  stop();
                }
              }}
            />
          )}
          <div className="zen-clock">
            <Clock now={clockNow} />
          </div>
          <div className="zen-bl">
            {running ? (
              <>
                <div className="zen-cap">{sessionLabel(minutes)}</div>
                <div className="zen-left">{formatLeft(left)}.</div>
              </>
            ) : (
              <div className="zen-start">
                <div className="breath-picker" role="radiogroup" aria-label="Session length">
                  {SESSION_MINUTES.map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={m === minutes} className="zbtn" onClick={() => setMinutes(m)}>
                      {m} min
                    </button>
                  ))}
                </div>
                <button type="button" className="zbtn go" onClick={start}>
                  <IconPlayerPlayFilled size={28} aria-hidden="true" />
                  Start
                </button>
              </div>
            )}
          </div>
          {running && <div className="zen-hint">Touch anywhere to end early</div>}
          <div className="zen-br">
            <button
              type="button"
              className="zbtn zleave"
              aria-label="Leave Zen"
              onClick={() => usePlaceStore.getState().setActive(usePlaceStore.getState().from)}
            >
              <IconX size={22} aria-hidden="true" />
              Leave
            </button>
            <Waiting />
          </div>
        </div>
      )}
    </section>
  );
}
