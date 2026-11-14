import { useState, type CSSProperties } from 'react';
import { IconRestore } from '@tabler/icons-react';
import { tip } from '../../ui/HoverTip';
import { HINTS, CONTROLS, controlWords, isUsual, resolveTune, type RangeControl, type SwitchControl } from './lookSettings';
import { lookName, type LookId } from './looks';
import { useWatchStore } from './store';

/** The foot of the section, and its hint while no control is in use. */
export const TUNE_FOOT = 'Each look keeps its own settings. Changes show at once.';

function RangeRow({ look, c, hint }: { look: LookId; c: RangeControl; hint: (k: string | null) => void }) {
  const tune = useWatchStore((s) => s.tune);
  const t = resolveTune(tune);
  const value = (t[look] as unknown as Record<string, number>)[c.key]!;
  const max = c.max(t);
  const words = controlWords(c, value);
  const span = Math.max(1, max - c.min);
  const style = { '--usual': `${((c.usual - c.min) / span) * 100}%`, '--at': `${((value - c.min) / span) * 100}%` } as CSSProperties;
  const id = `wk-${look}-${c.key}`;
  const k = `${look}.${c.key}`;
  return (
    <div className="ln-row" onPointerEnter={() => hint(k)} onPointerLeave={() => hint(null)}>
      <label className="ln-label" htmlFor={id}>
        {c.label}
      </label>
      <span className="ln-track" style={style}>
        <i className="ln-usual" aria-hidden="true" />
        <input
          id={id}
          type="range"
          min={c.min}
          max={max}
          step={c.step}
          value={value}
          aria-valuetext={words}
          {...tip(`${c.note}. The mark is your usual.`)}
          onFocus={() => hint(k)}
          onBlur={() => hint(null)}
          onChange={(e) => useWatchStore.getState().setTune(look, { [c.key]: Number(e.target.value) })}
        />
      </span>
      <span className="ln-value">{words}</span>
    </div>
  );
}

function SwitchRow({ look, c, hint }: { look: LookId; c: SwitchControl; hint: (k: string | null) => void }) {
  const tune = useWatchStore((s) => s.tune);
  const on = (tune[look] as unknown as Record<string, boolean>)[c.key]!;
  const k = `${look}.${c.key}`;
  const id = `wk-${look}-${c.key}-label`;
  return (
    <div className="ln-row" onPointerEnter={() => hint(k)} onPointerLeave={() => hint(null)}>
      <span className="ln-label" id={id}>
        {c.label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={id}
        className={`ln-switch${on ? ' on' : ''}`}
        {...tip(`${c.note}. ${on ? 'Click to turn it off.' : 'Click to turn it on.'}`)}
        onFocus={() => hint(k)}
        onBlur={() => hint(null)}
        onClick={() => useWatchStore.getState().setTune(look, { [c.key]: !on })}
      >
        <i aria-hidden="true" />
      </button>
      <span className="ln-value ln-fill">{on ? (c.usual ? 'On, your usual' : 'On') : c.usual ? 'Off' : 'Off, your usual'}</span>
    </div>
  );
}

/**
 * The Looks side's settings for one look (the sheet's section under the tiles): its sliders and
 * switches in the Lines side's rows, each value read back in plain words with the tick at "your
 * usual", the one-line hint of the control in use, and "Reset to my usual" for this look only.
 * Every change reaches the stage at once (`setTune`).
 */
export function LookTunePanel({ look }: { look: LookId }) {
  const tune = useWatchStore((s) => s.tune);
  const [hinted, setHinted] = useState<string | null>(null);
  const usual = isUsual(look, tune);
  return (
    <div className="wk-set" role="group" aria-label={`${lookName(look)} settings`} data-look={look}>
      <div className="ln-row ln-head">
        <span className="wk-name">{lookName(look)}</span>
        <button
          type="button"
          className={`ln-reset${usual ? ' wk-usual' : ''}`}
          aria-disabled={usual}
          {...tip(usual ? `${lookName(look)} is already at your usual` : `Every ${lookName(look)} setting back to your usual`)}
          onClick={() => {
            if (!usual) useWatchStore.getState().resetTune(look);
          }}
        >
          <IconRestore size={16} aria-hidden="true" />
          Reset to my usual
        </button>
      </div>
      {CONTROLS[look].map((c) => (c.kind === 'range' ? <RangeRow key={c.key} look={look} c={c} hint={setHinted} /> : <SwitchRow key={c.key} look={look} c={c} hint={setHinted} />))}
      <p className="ln-hint wk-hint">{hinted ? HINTS[hinted] : 'The mark on a slider is your usual.'}</p>
      <p className="ln-foot">{TUNE_FOOT}</p>
    </div>
  );
}
