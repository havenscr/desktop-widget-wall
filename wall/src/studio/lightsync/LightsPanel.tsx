import type { CSSProperties, ReactNode } from 'react';
import { IconRestore } from '@tabler/icons-react';
import { tip } from '../../ui/HoverTip';
import { useAudioStore } from '../../audio/store';
import { COLOUR_BARS, DEFAULT_LIGHTS_UI, DEFAULT_LIGHT_SYNC, LIGHT_NAMES, resolvePalette, type Follow } from './model';
import { coverNow, useLightSync } from './store';

/** The sheet heading on the Lights side. */
export const LIGHTS_TITLE = 'Light sync';

const pct = (v: number) => Math.round(v * 100);

/** "every 2 bars", "every bar", "every half bar". */
export function barsWords(bars: number): string {
  return bars === 1 ? 'every bar' : bars === 0.5 ? 'every half bar' : `every ${bars} bars`;
}
/** "15% to 90%". */
export function brightWords(floor: number, peak: number): string {
  return `${pct(floor)}% to ${pct(peak)}%`;
}
export function flashWords(v: number): string {
  const p = pct(v);
  return p < 34 ? 'soft' : p < 67 ? 'medium' : p < 90 ? 'strong' : 'hard';
}
/** Smoothness is the fade-back time (100 to 1500 ms) shown as 0 to 100. */
export const smoothOf = (releaseMs: number) => Math.round((releaseMs - 100) / 14);
export const releaseOf = (smooth: number) => Math.round(100 + (smooth * 1400) / 100);
export function smoothWords(smooth: number): string {
  return smooth < 10 ? 'snappy' : smooth < 35 ? 'a little smooth' : smooth < 65 ? 'smooth' : 'very smooth';
}

const FOLLOW_WORD: Record<Follow, string> = { bass: 'Bass', highs: 'Highs', both: 'Both' };
const FOLLOW_NOTE: Record<Follow, string> = { bass: 'follows the bass', highs: 'follows the highs', both: 'follows bass and highs' };

/** One slider row: label, the track, the value read back, then its helper line. */
function Row({ id, label, children, value, help }: { id: string; label: string; children: ReactNode; value: string; help: string }) {
  return (
    <>
      <div className="ln-row ls-row">
        <label className="ln-label" htmlFor={id}>
          {label}
        </label>
        {children}
        <span className="ln-value">{value}</span>
      </div>
      <p className="ln-hint ls-help">{help}</p>
    </>
  );
}

function One({ id, min, max, value, usual, words, note, onChange }: { id: string; min: number; max: number; value: number; usual: number; words: string; note: string; onChange: (v: number) => void }) {
  const style = { '--usual': `${((usual - min) / (max - min)) * 100}%`, '--at': `${((value - min) / (max - min)) * 100}%` } as CSSProperties;
  return (
    <span className="ln-track" style={style}>
      <i className="ln-usual" aria-hidden="true" />
      <input id={id} type="range" min={min} max={max} step={1} value={value} aria-valuetext={words} {...tip(`${note} The mark is your usual.`)} onChange={(e) => onChange(Number(e.target.value))} />
    </span>
  );
}

/** The Preview: the four Plays and the panels, drawn from the wall's sound right now with the chosen settings. */
function Preview() {
  const settings = useLightSync((s) => s.settings);
  const ui = useLightSync((s) => s.ui);
  const palette = useLightSync((s) => s.palette);
  const custom = useLightSync((s) => s.custom);
  const bass = useAudioStore((s) => s.bass);
  const high = useAudioStore((s) => s.high);
  const colours = resolvePalette(palette, { custom, cover: coverNow() }).colors;
  const amount = (f: Follow) => {
    const level = f === 'bass' ? bass : f === 'highs' ? high : (bass + high) / 2;
    const shaped = Math.min(1, Math.max(0, (level - 0.2) / 0.7));
    return Math.max(0.2, settings.floor + (settings.brightness - settings.floor) * shaped);
  };
  const fade = `opacity ${Math.round(settings.releaseMs)}ms`;
  return (
    <div className="ls-preview" role="img" aria-label="Preview of the lights, live" data-part="lights-preview">
      <svg className="ls-panels" viewBox="0 0 80 40" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <polygon key={i} points={`${8 + i * 14},34 ${15 + i * 14},6 ${22 + i * 14},34`} fill={colours[i % colours.length]} style={{ opacity: amount(ui.follow[4]), transition: fade }} />
        ))}
      </svg>
      <span className="ls-bar" aria-hidden="true" />
      <span className="ls-plays" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <i key={i} className="ls-play" style={{ background: colours[(i + 1) % colours.length], opacity: amount(ui.follow[i]), transition: fade }} />
        ))}
      </span>
    </div>
  );
}

/** The Lights side of the settings sheet: advanced settings for every palette. */
export function LightsPanel() {
  const s = useLightSync((st) => st.settings);
  const ui = useLightSync((st) => st.ui);
  const set = useLightSync.getState().setSettings;
  const barsAt = Math.max(0, COLOUR_BARS.indexOf(ui.colourBars));
  const floor = pct(s.floor);
  const peak = pct(s.brightness);
  const smooth = smoothOf(s.releaseMs);
  const dual = { '--lo': `${floor}%`, '--hi': `${peak}%`, '--usual': `${pct(DEFAULT_LIGHT_SYNC.floor)}%`, '--usual2': `${pct(DEFAULT_LIGHT_SYNC.brightness)}%` } as CSSProperties;
  return (
    <div className="ln-panel ls-panel" data-part="lights-panel">
      <div className="ls-head">
        <span className="ls-live">
          <i aria-hidden="true" />
          Preview, live
        </span>
        <button type="button" className="ln-reset ls-usualbtn" {...tip('Every Lights setting back to your usual: a colour every 2 bars, brightness 15% to 90%, strong flash, a little smooth, ripple on')} onClick={() => useLightSync.getState().resetLights()}>
          <IconRestore size={16} aria-hidden="true" />
          Your usual
        </button>
        <Preview />
      </div>
      <Row id="ls-speed" label="Colour speed" value={barsWords(ui.colourBars)} help="How quickly the lights move to the next colour.">
        <One id="ls-speed" min={0} max={COLOUR_BARS.length - 1} value={barsAt} usual={COLOUR_BARS.indexOf(DEFAULT_LIGHTS_UI.colourBars)} words={barsWords(ui.colourBars)} note="How quickly the lights move to the next colour, slow to fast." onChange={(i) => useLightSync.getState().setUi({ colourBars: COLOUR_BARS[i] })} />
      </Row>
      <div className="ln-row ls-row">
        <span className="ln-label" id="ls-bright-label">
          Brightness
        </span>
        <span className="ln-track ls-dual" style={dual} role="group" aria-labelledby="ls-bright-label">
          <i className="ln-usual" aria-hidden="true" />
          <i className="ln-usual ls-usual2" aria-hidden="true" />
          <input type="range" aria-label="Brightness floor" min={0} max={100} step={1} value={floor} aria-valuetext={`floor ${floor}%`} {...tip('The floor: how bright the lights stay when it is quiet. The mark is your usual.')} onChange={(e) => set({ floor: Math.min(50, Number(e.target.value), peak) / 100 })} />
          <input type="range" aria-label="Brightness peak" min={0} max={100} step={1} value={peak} aria-valuetext={`peak ${peak}%`} {...tip('The peak: the brightest a kick may make the lights. The mark is your usual.')} onChange={(e) => set({ brightness: Math.max(10, Number(e.target.value), floor) / 100 })} />
        </span>
        <span className="ln-value">{brightWords(s.floor, s.brightness)}</span>
      </div>
      <p className="ln-hint ls-help">Floor keeps the room lit when quiet; peak caps a kick.</p>
      <Row id="ls-flash" label="Kick flash" value={flashWords(s.kickFlash)} help="How hard a kick flashes the lights above the floor.">
        <One id="ls-flash" min={0} max={100} value={pct(s.kickFlash)} usual={pct(DEFAULT_LIGHT_SYNC.kickFlash)} words={flashWords(s.kickFlash)} note="How hard a kick flashes the lights, soft to hard." onChange={(v) => set({ kickFlash: v / 100 })} />
      </Row>
      <Row id="ls-smooth" label="Smoothness" value={smoothWords(smooth)} help="How slowly the lights fade back after a hit.">
        <One id="ls-smooth" min={0} max={100} value={smooth} usual={smoothOf(DEFAULT_LIGHT_SYNC.releaseMs)} words={smoothWords(smooth)} note="How slowly the lights fade back after a hit, snappy to smooth." onChange={(v) => set({ releaseMs: releaseOf(v) })} />
      </Row>
      <div className="ls-who">
        <span className="ln-label ls-wholabel" id="ls-who-label">
          Who follows
        </span>
        <div className="ls-tiles" role="group" aria-labelledby="ls-who-label">
          {LIGHT_NAMES.map((name, i) => (
            <button
              key={name}
              type="button"
              className={`ls-tile ${ui.follow[i]}`}
              data-follow={ui.follow[i]}
              aria-label={`${name}: ${FOLLOW_WORD[ui.follow[i]]}`}
              {...tip(`${name} ${FOLLOW_NOTE[ui.follow[i]]}. Click for the next: bass, highs, both.`)}
              onClick={() => useLightSync.getState().cycleFollow(i)}
            >
              <span>{name}</span>
              <b>{FOLLOW_WORD[ui.follow[i]]}</b>
            </button>
          ))}
        </div>
        <p className="ln-hint ls-help">Click a light to set bass, highs or both.</p>
      </div>
      <div className="ln-row ls-row">
        <span className="ln-label" id="ls-ripple-label">
          Panel ripple
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={ui.ripple}
          aria-labelledby="ls-ripple-label"
          className={`ln-switch${ui.ripple ? ' on' : ''}`}
          {...tip(ui.ripple ? 'Each kick rings out across the panels. Click to turn it off.' : 'The panels pulse whole. Click to ring out from the centre.')}
          onClick={() => useLightSync.getState().setUi({ ripple: !ui.ripple })}
        >
          <i aria-hidden="true" />
        </button>
        <span className="ln-value ln-fill ls-onoff">{ui.ripple ? 'On' : 'Off'}</span>
      </div>
      <p className="ln-hint ls-help">Each kick rings out across the panels from the centre.</p>
      <p className="ln-foot">Same for every palette. Only while the wall drives the lights.</p>
    </div>
  );
}
