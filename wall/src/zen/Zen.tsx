import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconPlayerPlayFilled, IconX } from '@tabler/icons-react';
import { Clock } from '../clock/Clock';
import { tip } from '../ui/HoverTip';
import { invoke } from '../bridge/tauri';
import { dayKey } from '../focus/day';
import { loadSettings, saveSettings } from '../settings/settings';
import { sun } from '../horizon/renderer';
import { useReducedMotion } from '../ui/useReducedMotion';
import { usePlaceStore } from '../state/places';
import { visibleRows } from '../tasks/model';
import { useTasks } from '../tasks/useTasks';
import { Breath } from './Breath';
import { Dream } from './Dream';
import { SheepSvg } from '../buddy/Watt';
import { SPRITES, SPRITE_PX } from '../buddy/sprites';
import { startBreath, stopBreath, setDream as setStageDream, resetStage, setMode as setStageMode, touchStage, startSundown, endSundown, clearSky } from './stage';
import { Sundown } from './Sundown';
import { SummitCaption, SummitScene } from './Summit';
import { useFocusStore } from '../focus/store';
import { DEFAULT_SUNDOWN_MINUTES, SUMMIT_MINUTES, SUNDOWN_MINUTES, ZEN_MODES, finishedLights, ZEN_MODE_LABELS, ZEN_MODE_TIPS, sundownRange, type SundownMinutes, type ZenMode } from './modes';
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
function useLeft(startedAt: number | null, minutes: number, nowMs: () => number): number {
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
  const [{ zenDimHour: dimHour, zenDimWaitMin: dimWaitMin, zenMode: savedMode, zenSundownLights: savedLights }] = useState(() => loadSettings());
  const reduced = useReducedMotion();
  const waitMs = dimWaitMin * 60_000;
  // Unwind's Dream tab opens Zen already dimmed; otherwise Zen starts bright.
  const [dream, setDream] = useState(() => usePlaceStore.getState().zenDream);
  useEffect(() => {
    usePlaceStore.getState().takeZenDream();
  }, []);
  // Summit shows the wall's one focus timer. When it is already running as Zen opens (started on Work), Zen opens on it.
  const focus = useFocusStore((st) => st.state);
  const focusSessions = useFocusStore((st) => st.sessions);
  const focusLoaded = useFocusStore((st) => st.loaded);
  const [mode, setModeState] = useState<ZenMode>(() => (useFocusStore.getState().state.status === 'running' ? 'summit' : savedMode));
  // A store that loads after Zen mounts: a running timer still opens Summit, once, unless a mode was already picked.
  const modeSettled = useRef(useFocusStore.getState().loaded);
  const modePicked = useRef(false);
  useEffect(() => {
    if (!focusLoaded || modeSettled.current) return;
    modeSettled.current = true;
    if (!modePicked.current && focus.status === 'running') setModeState('summit');
  }, [focusLoaded, focus.status]);
  const [lights, setLightsState] = useState(savedLights);
  const [breathMinutes, setMinutes] = useState<SessionMinutes>(5);
  const [sundownMinutes, setSundownMinutes] = useState<SundownMinutes>(DEFAULT_SUNDOWN_MINUTES);
  const minutes = mode === 'sundown' ? sundownMinutes : mode === 'summit' ? focus.minutes : breathMinutes;
  const setMode = (m: ZenMode) => {
    modePicked.current = true;
    setModeState(m);
    saveSettings({ zenMode: m });
  };
  const setLights = (on: boolean) => {
    setLightsState(on);
    saveSettings({ zenSundownLights: on });
  };
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
  // Summit runs while the focus timer does; its start is derived from the timer's end so a pause and resume keeps the climb.
  // A click on the stage leaves Summit (back to the start screen); the timer is not touched, so reopening Zen shows the session again.
  const [summitAway, setSummitAway] = useState(false);
  const summitRun = mode === 'summit' && focus.status === 'running' && !summitAway;
  const summitStart = summitRun ? focus.endAt - focus.minutes * 60_000 : null;
  const running = startedAt !== null || summitRun;
  const summitSession = useMemo(() => (summitRun && focus.status === 'running' ? { endAt: focus.endAt, minutes: focus.minutes } : null), [summitRun, focus]);
  // Lights follow the store (a session finishing adds one at once) and the local day (yesterday's clear at midnight).
  const [today, setToday] = useState(() => dayKey(nowMs()));
  useEffect(() => {
    const t = new Date(nowMs());
    const next = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).getTime();
    const id = setTimeout(() => setToday(dayKey(nowMs())), Math.max(1000, next - t.getTime()));
    return () => clearTimeout(id);
  }, [today, nowMs]);
  const summitLights = useMemo(() => finishedLights(focusSessions, nowMs()), [focusSessions, today, nowMs]);
  /** A stage click leaves the running session's view. Summit only closes: the focus timer and Do Not Disturb keep running. */
  const endEarly = () => {
    if (mode === 'summit') setSummitAway(true);
    else stop();
  };
  /** The End session button: the person's own click stops the shared focus timer, as Work's stop does. */
  const endSummit = () => useFocusStore.getState().reset();
  const startSummit = () => {
    const f = useFocusStore.getState();
    setSummitAway(false);
    if (f.state.status === 'paused') f.resume();
    else if (f.state.status !== 'running') f.startLabeled('Summit');
  };
  // True once a session ran to the end and Dream opens: only then do the Sundown lights stay down.
  const doneRef = useRef(false);
  const stageMode = useRef(mode);
  stageMode.current = mode;
  const left = useLeft(startedAt ?? summitStart, minutes, nowMs);

  // `?sundownage=<seconds>` in a development build starts a Sundown session that far in, for stills.
  const start = useCallback(() => {
    const age = import.meta.env.DEV && mode === 'sundown' ? Number(new URLSearchParams(window.location.search).get('sundownage')) || 0 : 0;
    const at = nowMs() - age * 1000;
    doneRef.current = false;
    // A still has no frames to glide over: with the `sundownage` knob present the sky starts at the session's own hour.
    const knob = import.meta.env.DEV && new URLSearchParams(window.location.search).has('sundownage');
    const range = sundownRange(at, sun);
    if (mode === 'sundown') startSundown(range, sundownMinutes * 60_000, performance.now() - age * 1000, reduced, knob ? range.from : nowMs());
    setStartedAt(at);
  }, [nowMs, mode, sundownMinutes, reduced]);
  // Ending early puts the sky back to the real hour.
  const stop = useCallback(() => {
    clearSky(performance.now(), nowMs());
    setStartedAt(null);
  }, [nowMs]);

  // The ridge reads the stage, not React state: it follows the running breath, or its own slow one on the start screen.
  useEffect(() => {
    if (startedAt === null) stopBreath();
    else if (mode === 'breath') startBreath(pattern, performance.now());
  }, [startedAt, pattern, mode]);
  // The mode picks what drives the picture; a switch glides (the ridge's own camera glide) because the driver is a level the loop reads.
  useEffect(() => {
    if (startedAt === null) setStageMode(mode);
  }, [mode, startedAt]);
  // Under reduced motion the sky steps instead of gliding, and a still frame redraws only when asked: ask once a second while Sundown runs.
  useEffect(() => {
    if (!reduced || startedAt === null || mode !== 'sundown') return;
    const id = window.setInterval(touchStage, 1000);
    return () => window.clearInterval(id);
  }, [reduced, startedAt, mode]);
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
    clearSky(performance.now(), nowMs());
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
      doneRef.current = true;
      setStartedAt(null);
      // A finished Sundown holds the night it reached; Dream fades out from it.
      if (stageMode.current === 'sundown') endSundown();
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
    if (dream || running) {
      setQuiet(false);
      return;
    }
    const id = window.setInterval(() => setQuiet(nowMs() - lastInput.current >= QUIET_FADE_MS), 1000);
    return () => window.clearInterval(id);
  }, [dream, running, nowMs]);

  // Late and quiet: dim by itself. Quiet is the PC's idle age (`wall2_idle_state`, in seconds), asked at most
  // every 10 s and only while Zen is lit (not dimmed), after the dim hour, with the page visible. When that command is
  // missing or fails, the wall's own input (the listeners above) is the fallback.
  useEffect(() => {
    let live = true;
    let busy = false;
    const id = window.setInterval(() => {
      if (dream || running || ending || busy || document.hidden) return;
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
  }, [dream, running, ending, nowMs, dimHour, waitMs]);

  // Zen covers the rail, so keep keyboard focus inside it. Focus follows the controls: the tap target
  // when a session starts (Start unmounts), Start when the picker returns, the first control otherwise.
  const root = useRef<HTMLElement>(null);
  const wasRunning = useRef(false);
  useEffect(() => {
    const r = root.current;
    if (!r) return;
    const running = (startedAt !== null || summitRun) && !ending;
    // The chosen length first, so the ring and the fill sit on the same chip at rest.
    const first = () => r.querySelector<HTMLElement>('[aria-label="Session length"] [role="radio"][aria-checked="true"]:not(:disabled)') ?? r.querySelector<HTMLElement>('button:not(:disabled), [role="button"]');
    if (!dream && running && !wasRunning.current) (r.querySelector<HTMLElement>('.zen-tap') ?? first())?.focus();
    else if (!dream && !running && wasRunning.current && startedAt === null) (r.querySelector<HTMLElement>('.zbtn.go') ?? first())?.focus();
    else if (!wasRunning.current && !running) first()?.focus();
    wasRunning.current = running;
  }, [dream, startedAt, summitRun, ending]);

  // Left and right arrows move along the mode chips, as the other chip rows do.
  const modeKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const at = ZEN_MODES.indexOf(mode);
    const next = ZEN_MODES[(at + (e.key === 'ArrowRight' ? 1 : ZEN_MODES.length - 1)) % ZEN_MODES.length];
    setMode(next);
    const chips = e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]');
    chips[ZEN_MODES.indexOf(next)]?.focus();
  };

  return (
    <section ref={root} className={`zen${dream ? ' is-dream' : ''}`} data-place="zen" aria-label="Zen">
      {dream ? (
        <Dream onWake={wake} now={clockNow} />
      ) : (
        <div className={`zen-guide${ending ? ' ending' : ''}`}>
          <div className="zen-watt" aria-hidden="true" style={{ left: SHORE_WATT.x, top: SHORE_WATT.base - SPRITES.idle.length * SPRITE_PX }}>
            <SheepSvg pose="idle" />
          </div>
          {mode === 'summit' && <SummitScene session={summitSession} lights={summitLights} now={nowMs} />}
          {running && mode === 'breath' && <Breath key={pattern.id} startedAt={startedAt} now={nowMs} pattern={pattern} />}
          {running && !ending && (
            <div
              className="zen-tap"
              role="button"
              tabIndex={0}
              aria-label={mode === 'summit' ? 'Close Summit' : 'End session early'}
              onClick={endEarly}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (e.repeat && e.key === 'Enter') return;
                  endEarly();
                }
              }}
            />
          )}
          <div className="zen-clock">
            <Clock now={clockNow} />
          </div>
          <div className="zen-bl">
            {running ? (
              mode === 'sundown' ? (
                startedAt !== null && <Sundown startedAt={startedAt} minutes={minutes} left={`${formatLeft(left)}.`} lights={lights} now={nowMs} doneRef={doneRef} />
              ) : mode === 'summit' ? (
                <SummitCaption minutes={minutes} left={`${formatLeft(left)}.`} lights={summitLights} />
              ) : (
                <>
                  <div className="zen-cap">{sessionLabel(minutes)}</div>
                  <div className="zen-left">{formatLeft(left)}.</div>
                </>
              )
            ) : (
              <div className={`zen-start${quiet ? ' quiet' : ''}`}>
                <div className="zen-moderow">
                  <div className="breath-picker" role="radiogroup" aria-label="Mode" onKeyDown={modeKeys}>
                  {ZEN_MODES.map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={m === mode} tabIndex={m === mode ? 0 : -1} className="zbtn sm" onClick={() => setMode(m)} {...tip(ZEN_MODE_TIPS[m], { align: 'start' })}>
                      {ZEN_MODE_LABELS[m]}
                    </button>
                  ))}
                  </div>
                  {mode === 'sundown' && (
                    <>
                    <span className="zen-sw-label" id="zen-lights-label">
                      Dim the office too
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={lights}
                      aria-labelledby="zen-lights-label"
                      className={`ln-switch${lights ? ' on' : ''}`}
                      onClick={() => setLights(!lights)}
                      {...tip(lights ? 'The Office lights step down three times while the sky sets, and back up if you leave early. Click to turn it off.' : 'Click to step the Office lights down three times while the sky sets. Only works while an Office mood is on.', { align: 'start' })}
                    >
                      <i aria-hidden="true" />
                    </button>
                    <span className="zen-sw-state">{lights ? 'On' : 'Off'}</span>
                    </>
                  )}
                </div>
                {mode === 'breath' && (
                  <div className="breath-picker" role="radiogroup" aria-label="Breathing pattern">
                    {BREATH_PATTERNS.map((p) => (
                      <button key={p.id} type="button" role="radio" aria-checked={p.id === pattern.id} className="zbtn sm" onClick={() => setPattern(p)} {...tip(p.tip, { align: 'start' })}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
                {mode === 'summit' && <div className="zen-note">Runs the focus timer, so Do Not Disturb comes with it. Leaving Zen does not stop it.</div>}
                {mode === 'sundown' && <div className="zen-note">Off unless you turn it on. Steps the Office lights down three times, and back up if you leave.</div>}
                <div className="zen-lenrow">
                  <div className="breath-picker" role="radiogroup" aria-label="Session length">
                    {(mode === 'sundown' ? SUNDOWN_MINUTES : mode === 'summit' ? summitChips(focus.minutes) : SESSION_MINUTES).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={m === minutes}
                        className="zbtn"
                        onClick={() => (mode === 'sundown' ? setSundownMinutes(m as SundownMinutes) : mode === 'summit' ? useFocusStore.getState().setMinutes(m) : setMinutes(m as SessionMinutes))}
                      >
                        {m} min
                      </button>
                    ))}
                  </div>
                  <button type="button" className="zbtn go" onClick={mode === 'summit' ? startSummit : start}>
                    <IconPlayerPlayFilled size={28} aria-hidden="true" />
                    {mode === 'summit' && focus.status === 'paused' ? 'Resume' : mode === 'summit' && focus.status === 'running' ? 'Back to Summit' : 'Start'}
                  </button>
                </div>
              </div>
            )}
            {!running && showDimHint(clockNow()) && <div className={`zen-dimhint${quiet ? ' quiet' : ''}`}>{dimHint(dimHour, dimWaitMin)}</div>}
          </div>
          {running && !ending && <div className="zen-hint">{mode === 'summit' ? 'Click anywhere to close Summit' : 'Click anywhere to end early'}</div>}
          <div className="zen-br">
            {summitRun && !ending && (
              <button type="button" className="zbtn zleave zend" onClick={endSummit} {...tip('Stops the focus timer and Do Not Disturb')}>
                End session
              </button>
            )}
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

/** Summit's length chips; a length Work set outside the usual three shows as its own selected chip. */
function summitChips(current: number): readonly number[] {
  return (SUMMIT_MINUTES as readonly number[]).includes(current) ? SUMMIT_MINUTES : [...SUMMIT_MINUTES, current].sort((a, b) => a - b);
}
