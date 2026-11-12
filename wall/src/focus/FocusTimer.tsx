import { IconMinus, IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlus, IconRotate } from '@tabler/icons-react';
import { useState } from 'react';
import { adjustMinutes, minutesLeft, PRESETS, ringFraction, type FocusState } from './model';
import { useFocus } from './useFocus';

const R = 74;
const C = 2 * Math.PI * R;

function Ring({ state, now }: { state: FocusState; now: number }) {
  const frac = ringFraction(state, now);
  const done = state.status === 'finished';
  return (
    <div className={`ring${done ? ' glow' : ''}`} role="img" aria-label={`${minutesLeft(state, now)} minutes left`}>
      <svg viewBox="0 0 176 176" width="176" height="176" aria-hidden="true">
        <circle cx="88" cy="88" r={R} className="ring-track" />
        <circle
          cx="88"
          cy="88"
          r={R}
          className="ring-arc"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
          transform="rotate(-90 88 88)"
        />
      </svg>
      <span className="ring-num">{done ? '0' : minutesLeft(state, now)}</span>
    </div>
  );
}

export function FocusTimer() {
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
          <div className="s">
            {state.status === 'idle' || state.status === 'finished'
              ? `${state.minutes} min session`
              : `${minutesLeft(state, f.now)} min left`}
          </div>
          <div className="focus-actions">
            {(state.status === 'idle' || state.status === 'finished') && (
              <button type="button" className="btn cy" onClick={f.start}>
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
      {adjustable && (
        <div className="focus-pick">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`chip${!custom && state.minutes === p ? ' on' : ''}`}
              aria-pressed={!custom && state.minutes === p}
              onClick={() => {
                setCustom(false);
                f.setMinutes(p);
              }}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            className={`chip${custom ? ' on' : ''}`}
            aria-pressed={custom}
            onClick={() => setCustom(true)}
          >
            Custom
          </button>
          {custom && (
            <div className="stepper">
              <button type="button" className="rd" aria-label="Fewer minutes" onClick={() => f.setMinutes(adjustMinutes(state.minutes, -1))}>
                <IconMinus size={30} aria-hidden="true" />
              </button>
              <span className="b6 stepper-val">{state.minutes} min</span>
              <button type="button" className="rd" aria-label="More minutes" onClick={() => f.setMinutes(adjustMinutes(state.minutes, 1))}>
                <IconPlus size={30} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
