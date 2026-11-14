import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { IconRestore } from '@tabler/icons-react';
import { tip } from '../../ui/HoverTip';
import { HINTS, CONTROLS, controlWords, isUsual, resolveTune, type RangeControl, type SwitchControl } from './lookSettings';
import { lookName, type LookId } from './looks';
import { flushTune, useWatchStore } from './store';

/** The foot of the section: its one line says this until a control is hovered or focused, then that control's hint. */
export const TUNE_FOOT = 'Each look keeps its own settings. Changes show at once.';

/**
 * The slider's keys, taken here so the effect is the same everywhere and proved by a test: the arrows
 * move one step (Up and Right on, Down and Left back), Page Up and Page Down ten steps, Home and End to
 * the ends. Every move is kept at once on the stage and written to storage when the key is let go.
 */
function keys(e: KeyboardEvent<HTMLInputElement>, look: LookId, c: RangeControl, value: number, max: number) {
  const step = c.step;
  const to: Record<string, number> = { ArrowRight: value + step, ArrowUp: value + step, ArrowLeft: value - step, ArrowDown: value - step, PageUp: value + 10 * step, PageDown: value - 10 * step, Home: c.min, End: max };
  const next = to[e.key];
  if (next === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  useWatchStore.getState().setTune(look, { [c.key]: Math.min(max, Math.max(c.min, next)) }, 'soon');
}

function RangeRow({ look, c, hint }: { look: LookId; c: RangeControl; hint: (k: string | null) => void }) {
  const tune = useWatchStore((s) => s.tune);
  const t = resolveTune(tune);
  const value = (t[look] as unknown as Record<string, number>)[c.key]!;
  const wish = (tune[look] as unknown as Record<string, number>)[c.key]!;
  const max = c.max(t);
  const words = controlWords(c, value, wish);
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
          onBlur={() => {
            hint(null);
            flushTune();
          }}
          onChange={(e) => useWatchStore.getState().setTune(look, { [c.key]: Number(e.target.value) }, 'soon')}
          onPointerUp={flushTune}
          onPointerCancel={flushTune}
          onKeyDown={(e) => keys(e, look, c, value, max)}
          onKeyUp={flushTune}
        />
      </span>
      <span className="ln-value">{words}</span>
    </div>
  );
}

function SwitchRow({ look, c, hint }: { look: LookId; c: SwitchControl; hint: (k: string | null) => void }) {
  const tune = useWatchStore((s) => s.tune);
  const rec = tune[look] as unknown as Record<string, boolean>;
  const on = rec[c.key]!;
  const blocked = c.needs ? rec[c.needs.key] === false : false;
  const k = `${look}.${c.key}`;
  const id = `wk-${look}-${c.key}-label`;
  return (
    <div className="ln-row" onPointerEnter={() => hint(k)} onPointerLeave={() => hint(null)}>
      <span className="ln-label wk-sw" id={id}>
        {c.label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on && !blocked}
        aria-disabled={blocked}
        aria-labelledby={id}
        className={`ln-switch${on && !blocked ? ' on' : ''}${blocked ? ' wk-blocked' : ''}`}
        {...tip(blocked ? `${c.needs!.reason}. ${c.note}` : `${c.note}. ${on ? 'Click to turn it off.' : 'Click to turn it on.'}`)}
        onFocus={() => hint(k)}
        onBlur={() => hint(null)}
        onClick={() => {
          if (!blocked) useWatchStore.getState().setTune(look, { [c.key]: !on });
        }}
      >
        <i aria-hidden="true" />
      </button>
      <span className="ln-value ln-fill">{blocked ? c.needs!.reason : on ? (c.words?.on ?? (c.usual ? 'On, your usual' : 'On')) : (c.words?.off ?? (c.usual ? 'Off' : 'Off, your usual'))}</span>
    </div>
  );
}

/**
 * The Looks side's settings for one look (the sheet's section under the tiles): its sliders and
 * switches in the Lines side's rows, each value read back in plain words with the tick at "your
 * usual", the one-line hint of the control in use, and "Reset to my usual" for this look only.
 * Every change reaches the stage at once (`setTune`).
 */
/**
 * Sets `data-more` on the rows' scrolling area (`below`, `above`, `both` or `none`) as it scrolls and
 * resizes, so the stylesheet fades only an edge that has more behind it.
 */
function useScrollEdges(ref: { current: HTMLDivElement | null }, look: LookId) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const above = el.scrollTop > 1;
      const below = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      el.dataset.more = above && below ? 'both' : below ? 'below' : above ? 'above' : 'none';
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [ref, look]);
}

export function LookTunePanel({ look, foot = TUNE_FOOT }: { look: LookId; foot?: string }) {
  const tune = useWatchStore((s) => s.tune);
  const [hinted, setHinted] = useState<string | null>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  useScrollEdges(rowsRef, look);
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
      <div className="wk-rows" ref={rowsRef}>
      {CONTROLS[look].map((c) => (c.kind === 'range' ? <RangeRow key={c.key} look={look} c={c} hint={setHinted} /> : <SwitchRow key={c.key} look={look} c={c} hint={setHinted} />))}
      </div>
      <p className="ln-foot wk-foot">{hinted ? HINTS[hinted] : foot}</p>
    </div>
  );
}
