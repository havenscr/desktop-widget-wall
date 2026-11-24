import type { KeyboardEvent } from 'react';
import { SKY_PLACES, SKY_STYLES, useBackdropSettings, type SkyStyle } from '../backdrop/settings';
import { hover } from './hover';

/** The rail's one line for the sky: "sky off", "sky on 1 page", "sky on 2 pages". */
export function skyLine(count: number): string {
  return count === 0 ? 'sky off' : `sky on ${count} ${count === 1 ? 'page' : 'pages'}`;
}

/** Left and Up back, Right and Down on, as a radio group does. */
function arrows(current: SkyStyle, pick: (id: SkyStyle) => void) {
  return (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = SKY_STYLES.findIndex((x) => x.id === current);
    pick(SKY_STYLES[(at + step + SKY_STYLES.length) % SKY_STYLES.length].id);
    const group = e.currentTarget;
    requestAnimationFrame(() => group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
  };
}

/**
 * The animated sky's two rows in the Display group: its style (one of two) and the pages it shows on (each chip on its own;
 * every chip off is the off switch). Changes apply live, with a fade.
 */
export function SkyPanel() {
  const style = useBackdropSettings((s) => s.style);
  const places = useBackdropSettings((s) => s.places);
  const available = useBackdropSettings((s) => s.available);
  const setStyle = useBackdropSettings((s) => s.setStyle);
  const toggle = useBackdropSettings((s) => s.togglePlace);
  return (
    <div className="tools-sky">
      <div className="tools-head">
        <span className="tools-k sm" {...hover('A slow animated sky behind the mountains, on the pages you choose. Still under reduced motion.')}>
          Sky
        </span>
      </div>
      <div className="tools-chips" role="radiogroup" aria-label="Sky style" onKeyDown={arrows(style, setStyle)}>
        {SKY_STYLES.map((s) => {
          const on = s.id === style;
          return (
            <button key={s.id} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className={on ? 'tools-chip on' : 'tools-chip'} {...hover(s.hint)} onClick={() => setStyle(s.id)}>
              {s.name}
            </button>
          );
        })}
      </div>
      <div className="tools-hint">How the sky moves: slow bands of colour, or swaying curtains of light.</div>
      <div className="tools-k sm tools-sky-label" id="tools-sky-on">
        Show on
      </div>
      <div className="tools-chips" role="group" aria-labelledby="tools-sky-on">
        {SKY_PLACES.map((p) => {
          const on = places.includes(p.id);
          return (
            <button key={p.id} type="button" className={on ? 'tools-chip on' : 'tools-chip'} aria-pressed={on} {...hover(on ? `Stop the animated sky on ${p.name}` : `Show the animated sky on ${p.name}`)} onClick={() => toggle(p.id)}>
              {p.name}
            </button>
          );
        })}
      </div>
      <div className="tools-hint">{available ? 'Each page on its own. With every page off, the sky stays still.' : 'The animated sky is not available on this PC.'}</div>
    </div>
  );
}
