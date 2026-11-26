import { IconMinus, IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlus, IconRotate, IconSquareFilled, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { adjustMinutes, MAX_LEFT_MS, MIN_LEFT_MS, minutesLeft, PRESETS, remainingMs, ringFraction, type FocusState } from './model';
import { UNDO_MS } from './store';
import { useFocus } from './useFocus';

/** The ring: 176 px with a 10 px stroke on the full card, smaller on the Work row (concept `.ring`). */
function Ring({ state, now, size = 176 }: { state: FocusState; now: number; size?: number }) {
  const frac = ringFraction(state, now);
  const done = state.status === 'finished';
  const stroke = size >= 120 ? 10 : 5;
  const r = size / 2 - stroke / 2 - (size >= 120 ? 9 : 0);
  const c = 2 * Math.PI * r;
  const m = size / 2;
  return (
    <div
      className={`ring${done ? ' glow' : ''}`}
      style={size === 176 ? undefined : { width: size, height: size }}
      role="img"
      aria-label={`${minutesLeft(state, now)} minutes left`}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle cx={m} cy={m} r={r} className="ring-track" style={{ strokeWidth: stroke }} />
        <circle
          cx={m}
          cy={m}
          r={r}
          className="ring-arc"
          style={{ strokeWidth: stroke }}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          transform={`rotate(-90 ${m} ${m})`}
        />
      </svg>
      <span className="ring-num" style={size === 176 ? undefined : { fontSize: Math.round(size * 0.32) }}>
        {done ? '0' : minutesLeft(state, now)}
      </span>
    </div>
  );
}

/**
 * The full focus card (the Work centre's fill): the heading, then the ring beside the
 * state, the task's name (up to two lines before an ellipsis) and the minutes, then one
 * row of mouse-sized controls along the foot (start, pause, resume or reset, and the
 * length picker while it can change). The ring takes the height the card has. `note` is
 * one quiet line at its foot (Work puts the weather status there while it has no reading).
 */
export function FocusTimer({ note }: { note?: ReactNode } = {}) {
  const f = useFocus();
  const { state } = f;
  const adjustable = state.status === 'idle' || state.status === 'finished';
  const [custom, setCustom] = useState(() => !(PRESETS as readonly number[]).includes(state.minutes));
  const caption =
    state.status === 'finished'
      ? 'Focus done'
      : state.status === 'running'
        ? 'Focusing'
        : state.status === 'paused'
          ? 'Paused'
          : 'Ready to focus';

  return (
    <section className="panel focus" aria-label="Focus timer">
      <span className="k">Focus</span>
      <div className="focus-body">
        <Ring state={state} now={f.now} />
        <div className="focus-side">
          <div className="t2">{caption}</div>
          {'label' in state && state.label && (
            <div className="b6 focus-label" title={state.label}>
              {state.label}
            </div>
          )}
          <div className="s">
            {state.status === 'idle' || state.status === 'finished'
              ? `${state.minutes} min session`
              : `${minutesLeft(state, f.now)} min left`}
          </div>
        </div>
      </div>
      <div className="focus-foot">
        {(state.status === 'idle' || state.status === 'finished') && (
          <button type="button" className="btn cy" onClick={() => f.start()}>
            <IconPlayerPlayFilled size={20} aria-hidden="true" />
            Start
          </button>
        )}
        {state.status === 'running' && (
          <button type="button" className="btn" onClick={f.pause}>
            <IconPlayerPauseFilled size={20} aria-hidden="true" />
            Pause
          </button>
        )}
        {state.status === 'paused' && (
          <button type="button" className="btn cy" onClick={f.resume}>
            <IconPlayerPlayFilled size={20} aria-hidden="true" />
            Resume
          </button>
        )}
        {state.status !== 'idle' && (
          <button type="button" className="btn" onClick={f.reset}>
            <IconRotate size={20} aria-hidden="true" />
            Reset
          </button>
        )}
        {adjustable && <Picker minutes={state.minutes} custom={custom} setCustom={setCustom} setMinutes={f.setMinutes} />}
      </div>
      {note && <div className="s focus-note">{note}</div>}
    </section>
  );
}

/** Session length: 25, 50, or Custom with a stepper (5 to 120 in steps of 5). */
function Picker({
  minutes,
  custom,
  setCustom,
  setMinutes,
}: {
  minutes: number;
  custom: boolean;
  setCustom: (on: boolean) => void;
  setMinutes: (m: number) => void;
}) {
  return (
    <div className="focus-pick">
      {PRESETS.map((p) => (
        <button
          key={p}
          type="button"
          className={`chip${!custom && minutes === p ? ' on' : ''}`}
          aria-pressed={!custom && minutes === p}
          onClick={() => {
            setCustom(false);
            setMinutes(p);
          }}
        >
          {p}
        </button>
      ))}
      <button type="button" className={`chip${custom ? ' on' : ''}`} aria-pressed={custom} onClick={() => setCustom(true)}>
        Custom
      </button>
      {custom && (
        <div className="stepper">
          <button type="button" className="rd" aria-label="Fewer minutes" onClick={() => setMinutes(adjustMinutes(minutes, -1))}>
            <IconMinus size={30} aria-hidden="true" />
          </button>
          <span className="b6 stepper-val">{minutes} min</span>
          <button type="button" className="rd" aria-label="More minutes" onClick={() => setMinutes(adjustMinutes(minutes, 1))}>
            <IconPlus size={30} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

/** How long the sheet and the undo row take to fade out. */
const FADE_MS = 220;

/**
 * The Work left wing's focus row (concept `f_work`, owner votes 1A and 2A): a small ring
 * with the minutes left, the label, and one round button (start, pause or resume). The
 * ring is a button that always opens a sheet above the row. Before a session it holds the
 * length (25, 50, Custom, Start). During one it holds the time left with 5 minute steps,
 * Pause or Resume, Restart and Stop. Stop and Restart act at once and the row offers Undo
 * for a few seconds.
 */
export function FocusMini() {
  const f = useFocus();
  const { state } = f;
  const adjustable = state.status === 'idle' || state.status === 'finished';
  const mode = adjustable ? 'length' : 'live';
  const [open, setOpen] = useState(false);
  // The sheet stays mounted for its fade out; `leaving` marks that (it is no dialog then).
  const [mounted, setMounted] = useState(false);
  const [custom, setCustom] = useState(() => !(PRESETS as readonly number[]).includes(state.minutes));
  const root = useRef<HTMLElement>(null);
  const ring = useRef<HTMLButtonElement>(null);
  // Which sheet was opened: a session starting or ending elsewhere (a task hold) closes it,
  // so it does not come back unasked.
  const [openMode, setOpenMode] = useState(mode);
  const shown = open && openMode === mode;
  const leaving = mounted && !shown;
  const left = minutesLeft(state, f.now);

  useEffect(() => {
    if (open && openMode !== mode) setOpen(false);
  }, [open, openMode, mode]);
  useEffect(() => {
    if (shown) {
      setMounted(true);
      return;
    }
    const id = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(id);
  }, [shown]);

  // Escape closes and hands focus back to the ring; a press outside closes.
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      ring.current?.focus();
    };
    const onPress = (e: Event) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [shown]);

  // The undo row fades in with the offer and out after it; `held` keeps the last offer for that fade.
  const [held, setHeld] = useState(f.undo);
  useEffect(() => {
    if (f.undo) {
      setHeld(f.undo);
      return;
    }
    const id = setTimeout(() => setHeld(null), FADE_MS);
    return () => clearTimeout(id);
  }, [f.undo]);
  const undoShown = f.undo !== null;
  const undoVisible = undoShown || held !== null;

  const title = f.undo
    ? f.undo.kind === 'restart'
      ? 'Restarted'
      : 'Focus stopped'
    : 'label' in state && state.label
      ? state.label
      : state.status === 'finished'
        ? 'Focus done'
        : state.status === 'idle'
          ? 'Ready to focus'
          : 'Focusing';
  const ringLabel = adjustable ? 'Choose a focus length' : `Focus controls, ${left} min left`;
  const paused = state.status === 'paused';
  const leftMs = remainingMs(state, f.now);
  // The pressed button unmounts, so focus goes back to the ring after these actions.
  const act = (fn: () => void) => () => {
    setOpen(false);
    fn();
    ring.current?.focus();
  };
  // The title crossfades: the old words fade out over the new ones.
  const [outTitle, setOutTitle] = useState<string | null>(null);
  const lastTitle = useRef(title);
  useEffect(() => {
    if (lastTitle.current === title) return;
    setOutTitle(lastTitle.current);
    lastTitle.current = title;
    const id = setTimeout(() => setOutTitle(null), FADE_MS);
    return () => clearTimeout(id);
  }, [title]);

  return (
    <section ref={root} className={`focus-mini${undoVisible ? ' has-undo' : ''}${undoShown ? '' : ' undo-out'}`} aria-label="Focus timer">
      <button
        ref={ring}
        type="button"
        className="focus-mini-ring"
        aria-label={ringLabel}
        aria-expanded={shown}
        onClick={() => {
          setOpenMode(mode);
          setOpen((o) => !(o && openMode === mode));
        }}
      >
        <Ring state={state} now={f.now} size={60} />
      </button>
      <div className="blk focus-mini-text">
        <span className="k">{paused && !f.undo ? 'Focus, paused' : 'Focus'}</span>
        <div className="t2 ellipsis focus-title">
          <span className={outTitle === null ? undefined : 'in'}>{title}</span>
          {outTitle !== null && (
            <span className="out" aria-hidden="true">
              {outTitle}
            </span>
          )}
        </div>
      </div>
      {undoVisible ? (
        <button type="button" className="btn cy focus-undo" onClick={() => {
            f.undoLast();
            ring.current?.focus();
          }}
          disabled={!undoShown}>
          <IconRotate size={24} aria-hidden="true" />
          Undo
        </button>
      ) : state.status === 'running' ? (
        <button type="button" className="rd" aria-label="Pause" onClick={f.pause}>
          <IconPlayerPauseFilled size={26} aria-hidden="true" />
        </button>
      ) : paused ? (
        <button type="button" className="rd" aria-label="Resume" onClick={f.resume}>
          <IconPlayerPlayFilled size={26} aria-hidden="true" />
        </button>
      ) : (
        <button type="button" className="rd" aria-label="Start" onClick={act(f.start)}>
          <IconPlayerPlayFilled size={26} aria-hidden="true" />
        </button>
      )}
      {undoVisible && <span className="focus-undo-line" style={{ animationDuration: `${UNDO_MS}ms` }} aria-hidden="true" />}
      {(shown || leaving) && openMode === 'length' && (
        <div className={`focus-sheet${shown ? '' : ' out'}`} role={shown ? 'dialog' : undefined} aria-label="Focus length">
          <div className="row sb">
            <span className="k">Focus length</span>
            <button type="button" className="rd" aria-label="Close" onClick={() => setOpen(false)}>
              <IconX size={28} aria-hidden="true" />
            </button>
          </div>
          <Picker minutes={state.minutes} custom={custom} setCustom={setCustom} setMinutes={f.setMinutes} />
          <button type="button" className="btn cy" onClick={act(f.start)}>
            <IconPlayerPlayFilled size={26} aria-hidden="true" />
            Start {state.minutes} min
          </button>
        </div>
      )}
      {(shown || leaving) && openMode === 'live' && (
        <div className={`focus-sheet live${shown ? '' : ' out'}`} role={shown ? 'dialog' : undefined} aria-label="Focus controls">
          <div className="row sb">
            <span className="k">{paused ? `Focus, paused, ${left} min left` : `Focus, ${left} min left`}</span>
            <button type="button" className="rd" aria-label="Close" onClick={() => setOpen(false)}>
              <IconX size={28} aria-hidden="true" />
            </button>
          </div>
          <div className="focus-left">
            <button type="button" className="rd" aria-label="5 minutes less" disabled={leftMs <= MIN_LEFT_MS} onClick={() => f.adjustLeft(-1)}>
              <IconMinus size={28} aria-hidden="true" />
            </button>
            <span className="b6 focus-left-val">{left} min</span>
            <button type="button" className="rd" aria-label="5 minutes more" disabled={leftMs >= MAX_LEFT_MS} onClick={() => f.adjustLeft(1)}>
              <IconPlus size={28} aria-hidden="true" />
            </button>
            <span className="s focus-left-hint">5 minutes a tap</span>
          </div>
          <div className="focus-acts">
            {paused ? (
              <button type="button" className="btn cy" onClick={f.resume}>
                <IconPlayerPlayFilled size={26} aria-hidden="true" />
                Resume
              </button>
            ) : (
              <button type="button" className="btn" onClick={f.pause}>
                <IconPlayerPauseFilled size={26} aria-hidden="true" />
                Pause
              </button>
            )}
            <button type="button" className="btn" onClick={act(f.restart)}>
              <IconRotate size={26} aria-hidden="true" />
              Restart {state.minutes} min
            </button>
            <button type="button" className="btn stop" onClick={act(f.stop)}>
              <IconSquareFilled size={22} aria-hidden="true" />
              Stop
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
