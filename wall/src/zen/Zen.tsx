import { useCallback, useEffect, useRef, useState } from 'react';
import { IconPlayerPlayFilled, IconX } from '@tabler/icons-react';
import { Clock } from '../clock/Clock';
import { tip } from '../ui/HoverTip';
import { invoke } from '../bridge/tauri';
import { loadSettings } from '../settings/settings';
import { usePlaceStore } from '../state/places';
import { visibleRows } from '../tasks/model';
import { useTasks } from '../tasks/useTasks';
import { Breath } from './Breath';
import { Dream } from './Dream';
import { SheepSvg } from '../buddy/Watt';
import { SPRITES, SPRITE_PX } from '../buddy/sprites';
import { startBreath, stopBreath, setDream as setStageDream, resetStage } from './stage';
import {
  BREATH_PATTERNS,
  SESSION_MINUTES,
  loadPattern,
  savePattern,
  type BreathPattern,
  formatLeft,
  dimDue,
  isDimHour,
  dimHint,
  showDimHint,
  sessionLabel,
  sessionSecondsLeft,
  waitingLines,
  type SessionMinutes,
} from './model';

const DIM_CHECK_MS = 10_000;
/** Input on the wall that counts as not quiet. */
const WALL_INPUT_EVENTS = ['pointerdown', 'pointermove', 'wheel', 'keydown'] as const;
/** With no input for this long the start screen's chips and words fade out; any input brings them back. */
export const QUIET_FADE_MS = 20_000;
/** Where Watt stands on the shore, in stage pixels (left edge and ground line). */
export const SHORE_WATT = { x: 1560, base: 668 } as const;
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
 * The Zen place: a full-stage view over the wall's own horizon (sky, ridge and lake), drawn on the Unwind camera by
 * `HorizonCanvas`. The ridge lines swell on the inhale and settle on the exhale, a short timed session. When a session ends it dims to the big thin clock (Dream's look); from 10 PM
 * (a setting) until 6 AM it also dims by itself after ten quiet minutes (a setting) of PC idle time
 * (the wall's own input when the system source is unavailable). A click anywhere wakes it, and it dims again only after another quiet wait. Separate
 * from the focus timer and from Do Not Disturb.
 */
export function Zen({ nowMs = Date.now }: ZenProps) {
  const [{ zenDimHour: dimHour, zenDimWaitMin: dimWaitMin }] = useState(() => loadSettings());
  const waitMs = dimWaitMin * 60_000;
  // Unwind's Dream tab opens Zen already dimmed; otherwise Zen starts bright.
  const [dream, setDream] = useState(() => usePlaceStore.getState().zenDream);
  useEffect(() => {
    usePlaceStore.getState().takeZenDream();
  }, []);
  const [minutes, setMinutes] = useState<SessionMinutes>(5);
  const [pattern, setPatternState] = useState<BreathPattern>(loadPattern);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const setPattern = (p: BreathPattern) => {
    setPatternState(p);
    savePattern(p);
  };
  // The start screen's chips and words fade away after a quiet spell and return on any input.
  const [quiet, setQuiet] = useState(false);
  // The last input on the wall (pointer, wheel or keys); the quiet wait counts from here.
  const lastInput = useRef(nowMs());
  const [ending, setEnding] = useState(false);
  const clockNow = useCallback(() => new Date(nowMs()), [nowMs]);
  const running = startedAt !== null;
  const left = useLeft(startedAt, minutes, nowMs);

  const start = useCallback(() => setStartedAt(nowMs()), [nowMs]);
  const stop = useCallback(() => setStartedAt(null), []);

  // The ridge reads the stage, not React state: it follows the running breath, or its own slow one on the start screen.
  useEffect(() => {
    if (startedAt !== null) startBreath(pattern, performance.now());
    else stopBreath();
  }, [startedAt, pattern]);
  // Dream fades the picture to black over its first minute (`?dreamage=<seconds>` in a development build starts that far in, for stills).
  useEffect(() => {
    if (!dream) {
      setStageDream(null);
      return;
    }
    const age = import.meta.env.DEV ? Number(new URLSearchParams(window.location.search).get('dreamage')) || 0 : 0;
    setStageDream(performance.now() - age * 1000);
  }, [dream]);
  useEffect(() => resetStage, []);
  const wake = useCallback(() => {
    lastInput.current = nowMs();
    setQuiet(false);
    setEnding(false);
    setStartedAt(null);
    setDream(false);
  }, [nowMs]);

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

  // Any input on the wall restarts the quiet wait.
  useEffect(() => {
    const seen = () => {
      lastInput.current = nowMs();
      setQuiet(false);
    };
    for (const e of WALL_INPUT_EVENTS) window.addEventListener(e, seen, { passive: true, capture: true });
    return () => {
      for (const e of WALL_INPUT_EVENTS) window.removeEventListener(e, seen, { capture: true });
    };
  }, [nowMs]);

  // A quiet start screen lets its chips and words go.
  useEffect(() => {
    if (dream || startedAt !== null) {
      setQuiet(false);
      return;
    }
    const id = window.setInterval(() => setQuiet(nowMs() - lastInput.current >= QUIET_FADE_MS), 1000);
    return () => window.clearInterval(id);
  }, [dream, startedAt, nowMs]);

  // Late and quiet: dim by itself. Quiet is the PC's idle age (`wall2_idle_state`, in seconds), asked at most
  // every 10 s and only while Zen is lit (not dimmed), after the dim hour, with the page visible. When that command is
  // missing or fails, the wall's own input (the listeners above) is the fallback.
  useEffect(() => {
    let live = true;
    let busy = false;
    const id = window.setInterval(() => {
      if (dream || startedAt !== null || ending || busy || document.hidden) return;
      if (!isDimHour(new Date(nowMs()), dimHour)) return;
      busy = true;
      const asked = nowMs();
      invoke<{ idleSecs?: number }>('wall2_idle_state')
        .then(
          (s) => {
            // A click or key on the wall after the question was sent makes the answer stale.
            if (live && lastInput.current <= asked && typeof s.idleSecs === 'number' && s.idleSecs * 1000 >= waitMs) setDream(true);
          },
          () => {
            if (live && dimDue(new Date(nowMs()), lastInput.current, dimHour, waitMs)) setDream(true);
          },
        )
        .finally(() => {
          busy = false;
        });
    }, DIM_CHECK_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [dream, startedAt, ending, nowMs, dimHour, waitMs]);

  // Zen covers the rail, so keep keyboard focus inside it. Focus follows the controls: the tap target
  // when a session starts (Start unmounts), Start when the picker returns, the first control otherwise.
  const root = useRef<HTMLElement>(null);
  const wasRunning = useRef(false);
  useEffect(() => {
    const r = root.current;
    if (!r) return;
    const running = startedAt !== null && !ending;
    // The chosen length first, so the ring and the fill sit on the same chip at rest.
    const first = () => r.querySelector<HTMLElement>('[aria-label="Session length"] [role="radio"][aria-checked="true"]:not(:disabled)') ?? r.querySelector<HTMLElement>('button:not(:disabled), [role="button"]');
    if (!dream && running && !wasRunning.current) (r.querySelector<HTMLElement>('.zen-tap') ?? first())?.focus();
    else if (!dream && !running && wasRunning.current && startedAt === null) (r.querySelector<HTMLElement>('.zbtn.go') ?? first())?.focus();
    else if (!wasRunning.current && !running) first()?.focus();
    wasRunning.current = running;
  }, [dream, startedAt, ending]);

  return (
    <section ref={root} className={`zen${dream ? ' is-dream' : ''}`} data-place="zen" aria-label="Zen">
      {dream ? (
        <Dream onWake={wake} now={clockNow} />
      ) : (
        <div className={`zen-guide${ending ? ' ending' : ''}`}>
          <div className="zen-watt" aria-hidden="true" style={{ left: SHORE_WATT.x, top: SHORE_WATT.base - SPRITES.idle.length * SPRITE_PX }}>
            <SheepSvg pose="idle" />
          </div>
          {running && <Breath key={pattern.id} startedAt={startedAt} now={nowMs} pattern={pattern} />}
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
                  if (e.repeat && e.key === 'Enter') return;
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
              <div className={`zen-start${quiet ? ' quiet' : ''}`}>
                <div className="breath-picker" role="radiogroup" aria-label="Breathing pattern">
                  {BREATH_PATTERNS.map((p) => (
                    <button key={p.id} type="button" role="radio" aria-checked={p.id === pattern.id} className="zbtn sm" onClick={() => setPattern(p)} {...tip(p.tip, { align: 'start' })}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="zen-lenrow">
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
              </div>
            )}
            {!running && showDimHint(clockNow()) && <div className={`zen-dimhint${quiet ? ' quiet' : ''}`}>{dimHint(dimHour, dimWaitMin)}</div>}
          </div>
          {running && !ending && <div className="zen-hint">Click anywhere to end early</div>}
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
