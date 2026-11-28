import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { IconActivity, IconBolt, IconBulb, IconDeviceFloppy, IconEar, IconLeaf, IconRestore, IconWaveSine } from '@tabler/icons-react';
import { tip } from '../../ui/HoverTip';
import { audioBeats, useAudioStore } from '../../audio/store';
import { COLOUR_BARS, DEFAULT_LIGHT_SYNC, INTENSITY_IDS, INTENSITY_NAME, INTENSITY_TIP, LIGHT_NAMES, driftOf, gainOf, isEdited, presetOf, releaseOf, resolvePalette, sensitivityOf, smoothOf, type Follow, type IntensityId } from './model';
import { newPreview, stepPreview } from './preview';
import { coverNow, useLightSync } from './store';

/** The sheet heading on the Lights side. */
export const LIGHTS_TITLE = 'Light sync';

const pct = (v: number) => Math.round(v * 100);

/** The colour speed read back as the drift it sends: "every 10 s". */
export function driftWords(driftMs: number): string {
  return `every ${Math.round(driftMs / 1000)} s`;
}
/** "45 to 100%". */
export function brightWords(floor: number, peak: number): string {
  return `${pct(floor)} to ${pct(peak)}%`;
}
/** Sensitivity as a word, calm to touchy. */
export function sensitivityWords(sensitivity: number): string {
  return sensitivity < 20 ? 'calm' : sensitivity < 40 ? 'gentle' : sensitivity < 60 ? 'steady' : sensitivity < 80 ? 'lively' : 'touchy';
}
export function flashWords(v: number): string {
  const p = pct(v);
  return p < 34 ? 'soft' : p < 67 ? 'medium' : p < 90 ? 'strong' : 'hard';
}
export { releaseOf, smoothOf };
export function smoothWords(smooth: number): string {
  return smooth < 10 ? 'snappy' : smooth < 35 ? 'a little smooth' : smooth < 65 ? 'smooth' : 'very smooth';
}

const ROLE_WORD: Record<Follow, string> = { bass: 'Bass', highs: 'Highs', both: 'Both' };
const ROLE_NOTE: Record<Follow, string> = { bass: 'follows the bass', highs: 'follows the highs', both: 'follows bass and highs' };
/** The room, left to right: the tile's name, and which light it sets (an index into `LIGHT_NAMES` and `ui.follow`: the four Plays, then the panels). */
const ROOM: readonly { name: string; at: number }[] = [
  { name: 'Far Left', at: 0 },
  { name: 'Left', at: 1 },
  { name: 'Shapes', at: 4 },
  { name: 'Right', at: 2 },
  { name: 'Far Right', at: 3 },
];

/** The live sound and the lights, once a frame: the sound's level lands on `--lvl`, each tile's light on `--glow` (0 to 1). Same maths as the engine (`preview.ts`). */
function useLive(root: React.RefObject<HTMLDivElement | null>) {
  const palette = useLightSync((s) => s.palette);
  const custom = useLightSync((s) => s.custom);
  const resolved = resolvePalette(palette, { custom, cover: coverNow() });
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
        el.style.setProperty('--lvl', String(Math.min(1, Math.max(a.bass, a.high))));
        const glow = (c: number[]) => Math.max(...c);
        const lights = [...f.plays.map(glow), f.panels.reduce((t, c) => t + glow(c), 0) / Math.max(1, f.panels.length)];
        el.querySelectorAll<HTMLElement>('[data-light]').forEach((e) => {
          const i = Number(e.getAttribute('data-light'));
          e.style.setProperty('--glow', lights[i].toFixed(3));
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [root]);
}

function Lamp({ shapes }: { shapes: boolean }) {
  return shapes ? (
    <span className="ls-lamp ls-shapes" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  ) : (
    <span className="ls-lamp ls-bulb" aria-hidden="true" />
  );
}

/** The room strip: one tile per light; a tap sets its role, Bass, Highs, Both. */
function Room() {
  const ui = useLightSync((st) => st.ui);
  return (
    <section className="ls-room" data-part="lights-room" aria-labelledby="ls-room-title">
      <div className="ls-roomhead">
        <span id="ls-room-title" className="ls-roomtitle" {...tip('Each light follows the bass, the highs or both. These settings are the same for every palette and apply only while the wall drives the lights.')}>
          Tap a light to set it
        </span>
        <span className="ls-legend" aria-hidden="true">
          {(['bass', 'highs', 'both'] as const).map((r) => (
            <span key={r} className={`ls-key ${r}`}>
              <i />
              {ROLE_WORD[r]}
            </span>
          ))}
        </span>
      </div>
      <div className="ls-tiles" role="group" aria-labelledby="ls-room-title">
        {ROOM.map(({ name, at }) => {
          const role = ui.follow[at];
          return (
            <button
              key={name}
              type="button"
              className={`ls-tile ${role}${at === 4 ? ' ls-wide' : ''}`}
              data-follow={role}
              data-light={at}
              aria-label={`${LIGHT_NAMES[at] === 'Panels' ? 'Shapes' : LIGHT_NAMES[at]}: ${ROLE_WORD[role]}`}
              {...tip(`${name} ${ROLE_NOTE[role]}. Tap for the next: Bass, Highs, Both.`)}
              onClick={() => useLightSync.getState().cycleFollow(at)}
            >
              <Lamp shapes={at === 4} />
              <span>{name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const PRESET_ICON: Record<IntensityId, typeof IconLeaf> = { subtle: IconLeaf, moderate: IconWaveSine, high: IconBolt };

/** The preset bar: Subtle, Moderate, High; a dot on the active one once a slider moves off it, Save to it, and Reset back to what it stored. */
function PresetBar() {
  const s = useLightSync((st) => st.settings);
  const ui = useLightSync((st) => st.ui);
  const group = useRef<HTMLDivElement>(null);
  const edited = isEdited(s, ui);
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
  const name = INTENSITY_NAME[ui.preset];
  return (
    <div className="ls-presets" data-part="lights-presets">
      <div className="w-seg ls-seg" role="radiogroup" aria-label="Preset" ref={group} onKeyDown={onKeyDown}>
        {INTENSITY_IDS.map((id) => {
          const Icon = PRESET_ICON[id];
          const on = ui.preset === id;
          return (
            <button key={id} type="button" role="radio" data-intensity={id} aria-checked={on} tabIndex={on ? 0 : -1} className={on ? 'on' : ''} {...tip(`${INTENSITY_TIP[id]}${on && edited ? ' A slider has moved off it.' : ''}`)} onClick={() => pick(id)}>
              <Icon size={18} aria-hidden="true" />
              {INTENSITY_NAME[id]}
              {on && edited ? <b className="ls-dot" data-part="preset-dot" aria-label="changed" /> : null}
            </button>
          );
        })}
      </div>
      <button type="button" className="ls-save" disabled={!edited} {...tip(edited ? `Keep these slider values as your ${name} preset.` : `No slider has moved off ${name}.`)} onClick={() => useLightSync.getState().savePreset()}>
        <IconDeviceFloppy size={18} aria-hidden="true" />
        Save to {name}
      </button>
      <button type="button" className="ls-undo" aria-label={`Reset ${name}`} disabled={!edited} {...tip(edited ? `Bring ${name} back to its saved values.` : `${name} is as saved.`)} onClick={() => useLightSync.getState().resetPreset()}>
        <IconRestore size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

/** One slider: the track filled to the value and a tick at your usual; `children` sit behind the thumb (the sound's level). */
function One({ id, label, min, max, value, usual, words, note, onChange, children }: { id: string; label: string; min: number; max: number; value: number; usual: number; words: string; note: string; onChange: (v: number) => void; children?: ReactNode }) {
  const style = { '--usual': `${((usual - min) / (max - min)) * 100}%`, '--at': `${((value - min) / (max - min)) * 100}%` } as CSSProperties;
  return (
    <span className="ln-track ls-one" style={style}>
      {children}
      <i className="ln-usual" aria-hidden="true" />
      <input id={id} type="range" aria-label={label} min={min} max={max} step={1} value={value} aria-valuetext={words} {...tip(`${note} The mark is your usual.`)} onChange={(e) => onChange(Number(e.target.value))} />
    </span>
  );
}

function Switch({ id, on, label, tipOn, tipOff, onClick }: { id: string; on: boolean; label: string; tipOn: string; tipOff: string; onClick: () => void }) {
  return (
    <span className="ls-sw">
      <span className="ls-swlabel" id={id}>
        {label}
      </span>
      <button type="button" role="switch" aria-checked={on} aria-labelledby={id} className={`ln-switch${on ? ' on' : ''}`} {...tip(on ? tipOn : tipOff)} onClick={onClick}>
        <i aria-hidden="true" />
      </button>
    </span>
  );
}

function Card({ icon, title, part, aside, children }: { icon: ReactNode; title: string; part: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="ls-card" data-part={part}>
      {aside !== undefined || title ? (
        <div className="ls-cardhead">
          <span className="ls-cardtitle">
            {icon}
            {title}
          </span>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** The Lights side of the settings sheet: the room first, then the preset bar and three groups (Hearing, Light, Motion). */
export function LightsPanel() {
  const s = useLightSync((st) => st.settings);
  const ui = useLightSync((st) => st.ui);
  const set = useLightSync.getState().setSettings;
  const root = useRef<HTMLDivElement>(null);
  useLive(root);
  const barsAt = Math.max(0, COLOUR_BARS.indexOf(ui.colourBars));
  const floor = pct(s.floor);
  const peak = pct(s.brightness);
  const smooth = smoothOf(s.releaseMs);
  const sens = sensitivityOf((s.bassGain + s.highGain) / 2);
  const usualSens = sensitivityOf(DEFAULT_LIGHT_SYNC.bassGain);
  const usual = presetOf(ui.preset, ui.saved);
  const dual = { '--lo': `${floor}%`, '--hi': `${peak}%`, '--usual': `${pct(usual.settings.floor)}%`, '--usual2': `${pct(usual.settings.brightness)}%` } as CSSProperties;
  return (
    <div className="ln-panel ls-panel" data-part="lights-panel" ref={root}>
      <Room />
      <PresetBar />
      <Card
        icon={<IconEar size={20} aria-hidden="true" />}
        title="Hearing"
        part="lights-hearing"
        aside={<Switch id="ls-auto-label" on={ui.autoLevel} label="Auto level" tipOn="Keeps the level steady from song to song. Click to turn it off." tipOff="Click to keep the level steady from song to song. Saved, but the light engine does not use it yet." onClick={() => useLightSync.getState().setUi({ autoLevel: !ui.autoLevel })} />}
      >
        <div className="ls-row">
          <label className="ls-label" htmlFor="ls-sens">
            Sensitivity
          </label>
          <One id="ls-sens" label="Sensitivity" min={0} max={100} value={sens} usual={usualSens} words={sensitivityWords(sens)} note="How much of the sound the lights hear, calm to touchy. The soft bar is the sound right now." onChange={(v) => set({ bassGain: gainOf(v), highGain: gainOf(v) })}>
            <i className="ls-level" aria-hidden="true" data-part="sound-level" />
          </One>
          <span className="ls-value">{sensitivityWords(sens)}</span>
        </div>
      </Card>
      <Card icon={<IconBulb size={20} aria-hidden="true" />} title="Light" part="lights-light" aside={<Switch id="ls-ripple-label" on={ui.ripple} label="Ripple" tipOn="Each kick rings out across the panels from the centre. Click to turn it off." tipOff="The panels pulse whole. Click to ring out from the centre." onClick={() => useLightSync.getState().setUi({ ripple: !ui.ripple })} />}>
        <div className="ls-row">
          <span className="ls-label" id="ls-bright-label">
            Brightness
          </span>
          <span className="ln-track ls-dual" style={dual} role="group" aria-labelledby="ls-bright-label">
            <i className="ln-usual" aria-hidden="true" />
            <i className="ln-usual ls-usual2" aria-hidden="true" />
            <input type="range" aria-label="Brightness floor" min={0} max={100} step={1} value={floor} aria-valuetext={`floor ${floor}%`} {...tip('The floor: how bright the lights stay when it is quiet. The mark is your usual.')} onChange={(e) => set({ floor: Math.max(5, Math.min(60, Number(e.target.value), peak - 10)) / 100 })} />
            <input type="range" aria-label="Brightness peak" min={0} max={100} step={1} value={peak} aria-valuetext={`peak ${peak}%`} {...tip('The peak: the brightest a kick may make the lights. The mark is your usual.')} onChange={(e) => set({ brightness: Math.max(20, Number(e.target.value), floor + 10) / 100 })} />
          </span>
          <span className="ls-value">{brightWords(s.floor, s.brightness)}</span>
        </div>
        <div className="ls-row">
          <label className="ls-label" htmlFor="ls-speed">
            Colour
          </label>
          <One id="ls-speed" label="Colour speed" min={0} max={COLOUR_BARS.length - 1} value={barsAt} usual={COLOUR_BARS.indexOf(usual.colourBars)} words={driftWords(driftOf(ui.colourBars))} note="How quickly the lights move to the next colour, slow to fast." onChange={(i) => useLightSync.getState().setUi({ colourBars: COLOUR_BARS[i] })} />
          <span className="ls-value">{driftWords(driftOf(ui.colourBars))}</span>
        </div>
      </Card>
      <Card icon={<IconActivity size={20} aria-hidden="true" />} title="" part="lights-motion">
        <div className="ls-pair">
          <div className="ls-half">
            <label className="ls-label ls-motion" htmlFor="ls-flash">
              <IconActivity size={20} aria-hidden="true" />
              Pulse
            </label>
            <One id="ls-flash" label="Pulse" min={0} max={100} value={pct(s.kickFlash)} usual={pct(usual.settings.kickFlash)} words={flashWords(s.kickFlash)} note="How strongly a kick lifts the lights above the floor, soft to hard." onChange={(v) => set({ kickFlash: v / 100 })} />
          </div>
          <div className="ls-half">
            <label className="ls-label" htmlFor="ls-smooth">
              Smooth
            </label>
            <One id="ls-smooth" label="Smooth" min={0} max={100} value={smooth} usual={smoothOf(usual.settings.releaseMs)} words={smoothWords(smooth)} note="How slowly the lights fade back after a hit, snappy to smooth." onChange={(v) => set({ releaseMs: releaseOf(v) })} />
          </div>
        </div>
      </Card>
    </div>
  );
}
