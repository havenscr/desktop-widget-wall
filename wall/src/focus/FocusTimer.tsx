import { IconMinus, IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlus, IconRotate, IconX } from '@tabler/icons-react';
import { useEffect, useState, type ReactNode } from 'react';
import { adjustMinutes, minutesLeft, PRESETS, ringFraction, type FocusState } from './model';
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

/** The full focus card. `note` is one quiet line at its foot (Work puts the weather status there while it has no reading). */
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
          {'label' in state && state.label && <div className="b6 focus-label ellipsis">{state.label}</div>}
          <div className="s">
            {state.status === 'idle' || state.status === 'finished'
              ? `${state.minutes} min session`
              : `${minutesLeft(state, f.now)} min left`}
          </div>
          <div className="focus-actions">
            {(state.status === 'idle' || state.status === 'finished') && (
              <button type="button" className="btn cy" onClick={() => f.start()}>
                <IconPlayerPlayFilled size={26} aria-hidden="true" />
                Start
              </button>
            )}
            {state.status === 'running' && (
              <button type="button" className="btn" onClick={f.pause}>
                <IconPlayerPauseFilled size={26} aria-hidden="true" />
                Pause
              </button>
            )}
            {state.status === 'paused' && (
              <button type="button" className="btn cy" onClick={f.resume}>
                <IconPlayerPlayFilled size={26} aria-hidden="true" />
                Resume
              </button>
            )}
            {state.status !== 'idle' && (
              <button type="button" className="btn" onClick={f.reset}>
                <IconRotate size={26} aria-hidden="true" />
                Reset
              </button>
            )}
          </div>
        </div>
      </div>
      {adjustable && <Picker minutes={state.minutes} custom={custom} setCustom={setCustom} setMinutes={f.setMinutes} />}
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

/**
 * The Work left wing's focus row (concept `f_work`, owner vote A): a small ring with the
 * minutes left, the label, and one round button (start, pause or resume). Tapping the ring while no session
 * runs opens a sheet with 25, 50, Custom and Start.
 */
export function FocusMini() {
  const f = useFocus();
  const { state } = f;
  const adjustable = state.status === 'idle' || state.status === 'finished';
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(() => !(PRESETS as readonly number[]).includes(state.minutes));
  const title =
    'label' in state && state.label
      ? state.label
      : state.status === 'finished'
        ? 'Focus done'
        : state.status === 'idle'
          ? 'Ready to focus'
          : 'Focusing';
  const sheet = open && adjustable;
  // A session started elsewhere (a task hold) closes the sheet, so it does not come back
  // unasked when the timer returns to idle.
  useEffect(() => {
    if (!adjustable) setOpen(false);
  }, [adjustable]);

  return (
    <section className="focus-mini" aria-label="Focus timer">
      <button
        type="button"
        className="focus-mini-ring"
        aria-label={adjustable ? 'Choose a focus length' : undefined}
        aria-expanded={adjustable ? sheet : undefined}
        onClick={() => adjustable && setOpen((o) => !o)}
      >
        <Ring state={state} now={f.now} size={60} />
      </button>
      <div className="blk focus-mini-text">
        <span className="k">{state.status === 'paused' ? 'Focus, paused' : 'Focus'}</span>
        <div className="t2 ellipsis">{title}</div>
      </div>
      {state.status === 'running' ? (
        <button type="button" className="rd" aria-label="Pause" onClick={f.pause}>
          <IconPlayerPauseFilled size={28} aria-hidden="true" />
        </button>
      ) : state.status === 'paused' ? (
        <button type="button" className="rd" aria-label="Resume" onClick={f.resume}>
          <IconPlayerPlayFilled size={28} aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          className="rd"
          aria-label="Start"
          onClick={() => {
            setOpen(false);
            f.start();
          }}
        >
          <IconPlayerPlayFilled size={28} aria-hidden="true" />
        </button>
      )}
      {sheet && (
        <div className="focus-sheet" role="dialog" aria-label="Focus length">
          <div className="row sb">
            <span className="k">Focus length</span>
            <button type="button" className="rd" aria-label="Close" onClick={() => setOpen(false)}>
              <IconX size={28} aria-hidden="true" />
            </button>
          </div>
          <Picker minutes={state.minutes} custom={custom} setCustom={setCustom} setMinutes={f.setMinutes} />
          <button
            type="button"
            className="btn cy"
            onClick={() => {
              setOpen(false);
              f.start();
            }}
          >
            <IconPlayerPlayFilled size={26} aria-hidden="true" />
            Start {state.minutes} min
          </button>
        </div>
      )}
    </section>
  );
}
