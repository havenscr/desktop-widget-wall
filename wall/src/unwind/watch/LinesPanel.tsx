import type { CSSProperties, KeyboardEvent } from 'react';
import { IconRestore, IconSettings } from '@tabler/icons-react';
import { tip } from '../../ui/HoverTip';
import { DEFAULT_LINES, LINE_PRESETS, activePreset, useLinesStore, type LineColours, type LinePreset, type LineRest, type LineType } from '../../horizon/linesSettings';
import { useWatchStore } from './store';

/** The sheet heading and name on the Lines side. */
export const LINES_TITLE = 'How the lines move';

const TYPES: { id: LineType; name: string; note: string }[] = [
  { id: 'mountains', name: 'Mountains', note: 'The ridgelines dance as they do today; hits ripple back through them.' },
  { id: 'bars', name: 'Bars', note: 'Bars rise from the horizon, bass in the middle; markers float down.' },
  { id: 'ribbon', name: 'Ribbon', note: 'One glowing ribbon; hits lift it into a wave with two faint trails.' },
  { id: 'sparks', name: 'Sparks', note: 'A row of dots; a hit throws them up and they fall back.' },
  { id: 'skyline', name: 'Skyline', note: 'Stepped blocks like a far city, built a floor at a time.' },
];
const COLOURS: { id: LineColours; name: string; note: string }[] = [
  { id: 'look', name: 'From the look', note: "The wall's own colours, or the playing cover's" },
  { id: 'floor', name: 'Floor light', note: 'The amber, pink and cyan the screen throws on the floor' },
  { id: 'sunset', name: 'Sunset', note: 'Amber to pink' },
  { id: 'ice', name: 'Ice', note: 'Pale blue to white' },
  { id: 'mint', name: 'Mint', note: 'Mint to cyan' },
];
const RESTS: { id: LineRest; name: string; note: string }[] = [
  { id: 'ridgelevels', name: 'Ridge', note: 'At rest: one bright line on the ridge over straight levels' },
  { id: 'flat', name: 'Flat', note: 'At rest: everything lies down to one calm line on the horizon' },
];
const PRESETS: { id: LinePreset; name: string; note: string }[] = [
  { id: 'calm', name: 'Calm', note: 'Calm: lively 22, smooth 72, up to 60 px' },
  { id: 'dancing', name: 'Dancing', note: 'Dancing, your usual: lively 50, smooth 50, up to 104 px' },
  { id: 'wild', name: 'Wild', note: 'Wild: lively 88, smooth 28, up to 180 px' },
];

type SliderField = 'lively' | 'smooth' | 'height';
const SLIDERS: { field: SliderField; label: string; min: number; max: number; unit: string; more: string; less: string; note: string }[] = [
  { field: 'lively', label: 'How lively', min: 0, max: 100, unit: '', more: 'livelier', less: 'calmer', note: 'How high hits throw the lines and how much they move' },
  { field: 'smooth', label: 'Smoothness', min: 0, max: 100, unit: '', more: 'smoother', less: 'snappier', note: 'How slowly the lines fall back after a hit' },
  { field: 'height', label: 'Height', min: 20, max: 220, unit: ' px', more: 'taller', less: 'lower', note: 'The most a hit may throw a line above its place' },
];

/** A slider's value read back in plain words and numbers, on one line. */
export function sliderWords(field: SliderField, value: number): string {
  const s = SLIDERS.find((x) => x.field === field)!;
  const usual = DEFAULT_LINES[field];
  const shown = `${Math.round(value)}${s.unit}`;
  if (value === usual) return `${shown}, your usual`;
  return `${shown}, ${value > usual ? s.more : s.less} than usual`;
}

/** Arrow keys move a group's choice (Left and Up back, Right and Down on), as a radio group does. */
function arrows<T>(items: { id: T }[], current: T, pick: (id: T) => void) {
  return (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = items.findIndex((x) => x.id === current);
    const next = items[(at + step + items.length) % items.length];
    pick(next.id);
    const group = e.currentTarget;
    requestAnimationFrame(() => group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
  };
}

function Slider({ field }: { field: SliderField }) {
  const s = SLIDERS.find((x) => x.field === field)!;
  const value = useLinesStore((st) => st[field]);
  const usual = DEFAULT_LINES[field];
  const words = sliderWords(field, value);
  const style = { '--usual': `${((usual - s.min) / (s.max - s.min)) * 100}%`, '--at': `${((value - s.min) / (s.max - s.min)) * 100}%` } as CSSProperties;
  return (
    <div className="ln-row">
      <label className="ln-label" htmlFor={`ln-${field}`}>
        {s.label}
      </label>
      <span className="ln-track" style={style}>
        <i className="ln-usual" aria-hidden="true" />
        <input
          id={`ln-${field}`}
          type="range"
          min={s.min}
          max={s.max}
          step={1}
          value={value}
          aria-valuetext={words}
          {...tip(`${s.note}. The mark is your usual.`)}
          onChange={(e) => useLinesStore.getState().setLines({ [field]: Number(e.target.value) })}
        />
      </span>
      <span className="ln-value">{words}</span>
    </div>
  );
}

/** The Lines side of the settings sheet: one setting for the lines everywhere music plays. */
export function LinesPanel() {
  const s = useLinesStore();
  const set = s.setLines;
  const type = TYPES.find((x) => x.id === s.type)!;
  const colours = COLOURS.find((x) => x.id === s.colours)!;
  const preset = activePreset(s);
  return (
    <div className="ln-panel">
      <div className="ln-row ln-head">
        <span className="ln-label">Type</span>
        <span className="ln-value">
          {type.name}
          {s.type === DEFAULT_LINES.type ? ', your usual' : ''}
        </span>
      </div>
      <div className="ln-chips ln-types" role="radiogroup" aria-label="Line type" onKeyDown={arrows(TYPES, s.type, (id) => set({ type: id }))}>
        {TYPES.map((x) => (
          <button
            key={x.id}
            type="button"
            role="radio"
            aria-checked={s.type === x.id}
            tabIndex={s.type === x.id ? 0 : -1}
            className={s.type === x.id ? 'on' : ''}
            {...tip(x.note)}
            onClick={() => set({ type: x.id })}
          >
            {x.name}
          </button>
        ))}
      </div>
      <p className="ln-hint">{type.note}</p>
      <Slider field="lively" />
      <Slider field="smooth" />
      <Slider field="height" />
      <div className="ln-row">
        <span className="ln-label" id="ln-colours-label">
          Colours
        </span>
        <div className="ln-swatches" role="radiogroup" aria-labelledby="ln-colours-label" onKeyDown={arrows(COLOURS, s.colours, (id) => set({ colours: id }))}>
          {COLOURS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="radio"
              aria-checked={s.colours === x.id}
              aria-label={x.name}
              tabIndex={s.colours === x.id ? 0 : -1}
              className={`ln-sw ${x.id}${s.colours === x.id ? ' on' : ''}`}
              {...tip(`${x.name}: ${x.note}`)}
              onClick={() => set({ colours: x.id })}
            >
              <i aria-hidden="true" />
            </button>
          ))}
        </div>
        <span className="ln-value">{colours.name}</span>
      </div>
      <div className="ln-row">
        <span className="ln-label" id="ln-refl-label">
          Reflection
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={s.reflection}
          aria-labelledby="ln-refl-label"
          className={`ln-switch${s.reflection ? ' on' : ''}`}
          {...tip(s.reflection ? 'The lines are mirrored in the floor. Click to turn it off.' : 'No mirror in the floor. Click to mirror the lines.')}
          onClick={() => set({ reflection: !s.reflection })}
        >
          <i aria-hidden="true" />
        </button>
        <span className="ln-label ln-sub" id="ln-rest-label">
          At rest
        </span>
        <div className="ln-chips" role="radiogroup" aria-labelledby="ln-rest-label" onKeyDown={arrows(RESTS, s.rest, (id) => set({ rest: id }))}>
          {RESTS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="radio"
              aria-checked={s.rest === x.id}
              tabIndex={s.rest === x.id ? 0 : -1}
              className={s.rest === x.id ? 'on' : ''}
              {...tip(x.note)}
              onClick={() => set({ rest: x.id })}
            >
              {x.name}
            </button>
          ))}
        </div>
      </div>
      <div className="ln-row">
        <span className="ln-label">Presets</span>
        <div className="ln-chips" role="group" aria-label="Presets">
          {PRESETS.map((x) => (
            <button key={x.id} type="button" aria-pressed={preset === x.id} className={preset === x.id ? 'on' : ''} {...tip(x.note)} onClick={() => set(LINE_PRESETS[x.id])}>
              {x.name}
            </button>
          ))}
        </div>
        <button type="button" className="ln-reset" {...tip('Every lines setting back to your usual: Mountains, 50, 50, 104 px, from the look, reflection on, ridge at rest')} onClick={s.reset}>
          <IconRestore size={16} aria-hidden="true" />
          Reset to my usual
        </button>
      </div>
      <p className="ln-foot">One setting for the lines everywhere music plays.</p>
    </div>
  );
}

/** The gear on Listen: opens the same sheet on its Lines side. */
export function LinesGear() {
  const open = useWatchStore((st) => st.sheet);
  return (
    <button
      type="button"
      className={`w-gear${open ? ' on' : ''}`}
      aria-label={LINES_TITLE}
      aria-expanded={open}
      aria-haspopup="dialog"
      {...tip('How the music lines move: type, how lively, colours and more')}
      onClick={() => useWatchStore.getState().setSheet(!open)}
    >
      <IconSettings size={26} aria-hidden="true" />
    </button>
  );
}
