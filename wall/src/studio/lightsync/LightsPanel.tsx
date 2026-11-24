import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { IconRestore } from '@tabler/icons-react';
import { tip } from '../../ui/HoverTip';
import { audioBeats, useAudioStore } from '../../audio/store';
import { COLOUR_BARS, DEFAULT_LIGHTS_UI, DEFAULT_LIGHT_SYNC, INTENSITY_IDS, INTENSITY_NAME, INTENSITY_TIP, LIGHT_NAMES, driftOf, intensityOf, resolvePalette, type Follow, type IntensityId } from './model';
import { newPreview, stepPreview } from './preview';
import { coverNow, useLightSync } from './store';

/** The sheet heading on the Lights side. */
export const LIGHTS_TITLE = 'Light sync';

const pct = (v: number) => Math.round(v * 100);

/** The colour speed read back as the drift it sends: "a colour every 10 s". */
export function driftWords(driftMs: number): string {
  return `a colour every ${Math.round(driftMs / 1000)} s`;
}
/** "15% to 90%". */
export function brightWords(floor: number, peak: number): string {
  return `${pct(floor)}% to ${pct(peak)}%`;
}
export function flashWords(v: number): string {
  const p = pct(v);
  return p < 34 ? 'soft' : p < 67 ? 'medium' : p < 90 ? 'strong' : 'hard';
}
/** Smoothness is the fade-back time (200 to 2000 ms) shown as 0 to 100. */
export const smoothOf = (releaseMs: number) => Math.round((releaseMs - 200) / 18);
export const releaseOf = (smooth: number) => Math.round(200 + (smooth * 1800) / 100);
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

/** The Intensity row: three buttons in one group (arrows move and pick, Home and End jump), "Custom" read back once a slider has moved. */
function IntensityRow() {
  const s = useLightSync((st) => st.settings);
  const ui = useLightSync((st) => st.ui);
  const group = useRef<HTMLDivElement>(null);
  const now = intensityOf(s, ui);
  const pick = (id: IntensityId) => useLightSync.getState().setIntensity(id);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = INTENSITY_IDS.indexOf(document.activeElement?.getAttribute('data-intensity') as IntensityId);
    const n = INTENSITY_IDS.length;
    const to = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (at + n - 1) % n : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (at + 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (at < 0 || to < 0) return;
    e.preventDefault();
    pick(INTENSITY_IDS[to]);
    group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[to]?.focus();
  };
  return (
    <>
      <div className="ln-row ls-row ls-intensity">
        <span className="ln-label" id="ls-intensity-label">
          Intensity
        </span>
        <div className="w-seg ls-seg" role="radiogroup" aria-labelledby="ls-intensity-label" ref={group} onKeyDown={onKeyDown}>
          {INTENSITY_IDS.map((id, i) => (
            <button key={id} type="button" role="radio" data-intensity={id} aria-checked={now === id} tabIndex={now === id || (now === null && i === 0) ? 0 : -1} className={now === id ? 'on' : ''} {...tip(INTENSITY_TIP[id])} onClick={() => pick(id)}>
              {INTENSITY_NAME[id]}
            </button>
          ))}
        </div>
        <span className="ln-value ln-fill ls-custom" data-part="intensity-value">
          {now === null ? 'Custom' : ''}
        </span>
      </div>
      <p className="ln-hint ls-help">How lively the lights are. Moving a slider below shows Custom.</p>
    </>
  );
}

const PANEL_COUNT = [0, 1, 2, 3, 4];

/** The Preview: two labelled strips, the panels and the four Plays, drawn from the wall's sound right now by the engine's own maths (`preview.ts`). */
function Preview() {
  const palette = useLightSync((s) => s.palette);
  const custom = useLightSync((s) => s.custom);
  const resolved = resolvePalette(palette, { custom, cover: coverNow() });
  const colours = resolved.colors;
  const root = useRef<HTMLDivElement>(null);
  const live = useRef({ palette: resolved });
  live.current.palette = resolved;
  useEffect(() => {
    const state = newPreview(useLightSync.getState().settings.floor, audioBeats().count);
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const { settings, ui } = useLightSync.getState();
      const a = useAudioStore.getState();
      const f = stepPreview(state, settings, ui, live.current.palette, { bass: a.bass, high: a.high, beatCount: audioBeats().count, dtMs: now - last });
      last = now;
      const el = root.current;
      if (el) {
        // The colour each light really shows, brightness included: dark where the lights go dark.
        const css = (c: number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
        el.querySelectorAll<HTMLElement>('.ls-play i').forEach((e, i) => {
          e.style.background = css(f.plays[i]);
        });
        el.querySelectorAll<HTMLElement>('.ls-pn').forEach((e, i) => {
          e.style.background = css(f.panels[i]);
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="ls-preview" role="img" aria-label="Preview of the lights, live" data-part="lights-preview" ref={root}>
      <div className="ls-strip" data-row="panels" {...tip('Panels: five stand-in triangles in a row, lit as the Nanoleaf panels would be right now. The real layout of your panels is not known here, so how the ring spreads is approximate.')}>
        <b>Panels</b>
        <span className="ls-pns">
          {PANEL_COUNT.map((i) => (
            <i key={i} className="ls-pn" style={{ background: colours[i % colours.length] }} />
          ))}
        </span>
      </div>
      <div className="ls-strip" data-row="plays" {...tip('Plays: the four Play bars, left to right, each lit as it would be right now.')}>
        <b>Plays</b>
        <span className="ls-plays">
          {LIGHT_NAMES.slice(0, 4).map((name) => (
            <span key={name} className="ls-play">
              <i style={{ background: colours[0] }} />
              <em>{name}</em>
            </span>
          ))}
        </span>
      </div>
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
      <IntensityRow />
      <div className="ls-head">
        <span className="ls-live">
          <i aria-hidden="true" />
          Preview, live
        </span>
        <button type="button" className="ln-reset ls-usualbtn" {...tip('Every Lights setting back to your usual, which is Subtle: a colour every 10 s, brightness 35% to 80%, a soft pulse, smooth fades, ripple on')} onClick={() => useLightSync.getState().resetLights()}>
          <IconRestore size={16} aria-hidden="true" />
          Your usual
        </button>
        <Preview />
      </div>
      <Row id="ls-speed" label="Colour speed" value={driftWords(driftOf(ui.colourBars))} help="How quickly the lights move to the next colour.">
        <One id="ls-speed" min={0} max={COLOUR_BARS.length - 1} value={barsAt} usual={COLOUR_BARS.indexOf(DEFAULT_LIGHTS_UI.colourBars)} words={driftWords(driftOf(ui.colourBars))} note="How quickly the lights move to the next colour, slow to fast." onChange={(i) => useLightSync.getState().setUi({ colourBars: COLOUR_BARS[i] })} />
      </Row>
      <div className="ln-row ls-row">
        <span className="ln-label" id="ls-bright-label">
          Brightness
        </span>
        <span className="ln-track ls-dual" style={dual} role="group" aria-labelledby="ls-bright-label">
          <i className="ln-usual" aria-hidden="true" />
          <i className="ln-usual ls-usual2" aria-hidden="true" />
          <input type="range" aria-label="Brightness floor" min={0} max={100} step={1} value={floor} aria-valuetext={`floor ${floor}%`} {...tip('The floor: how bright the lights stay when it is quiet. The mark is your usual.')} onChange={(e) => set({ floor: Math.max(5, Math.min(60, Number(e.target.value), peak - 10)) / 100 })} />
          <input type="range" aria-label="Brightness peak" min={0} max={100} step={1} value={peak} aria-valuetext={`peak ${peak}%`} {...tip('The peak: the brightest a kick may make the lights. The mark is your usual.')} onChange={(e) => set({ brightness: Math.max(20, Number(e.target.value), floor + 10) / 100 })} />
        </span>
        <span className="ln-value">{brightWords(s.floor, s.brightness)}</span>
      </div>
      <p className="ln-hint ls-help">Floor keeps the room lit when quiet; peak caps a kick.</p>
      <Row id="ls-flash" label="Pulse" value={flashWords(s.kickFlash)} help="How strongly a kick lifts the lights above the floor.">
        <One id="ls-flash" min={0} max={100} value={pct(s.kickFlash)} usual={pct(DEFAULT_LIGHT_SYNC.kickFlash)} words={flashWords(s.kickFlash)} note="How strongly a kick lifts the lights, soft to hard." onChange={(v) => set({ kickFlash: v / 100 })} />
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
