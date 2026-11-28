import { useId, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { IconActivity, IconArrowsExchange, IconBan, IconBaselineDensityMedium, IconBolt, IconChevronDown, IconEqual, IconFocus2, IconPlayerPlay, IconRestore, IconSettings } from '@tabler/icons-react';
import { tip } from '../../ui/HoverTip';
import { DEFAULT_LINES, LINE_PRESETS, activePreset, useLinesStore, type LineColours, type LinePreset, type LineRest, type LineType } from '../../horizon/linesSettings';
import { SENSITIVITY_DEFAULT, SENSITIVITY_MAX, SENSITIVITY_MIN, useVibeStore, type AuroraLevel, type GlitchLength, type GlitchLook, type GlitchStrength, type MountainLevel } from '../../horizon/vibeSettings';
import { fireTry } from '../../vibe/tryIt';
import { useAudioStore } from '../../audio/store';
import { loudness } from '../../audio/model';
import type { MusicLevel } from '../../horizon/offTabMusic';
import { useWatchStore } from './store';

/** The sheet heading and name on the Lines side. */
export const LINES_TITLE = 'How the lines move';
/** The sheet heading and name on the Vibe side. */
export const VIBE_TITLE = 'The vibe';

const TYPES: { id: LineType; name: string; note: string }[] = [
  { id: 'mountains', name: 'Mountains', note: 'The ridgelines dance as they do today.' },
  { id: 'bars', name: 'Bars', note: 'Bars rise from the horizon, bass in the middle.' },
  { id: 'ribbon', name: 'Ribbon', note: 'One glowing ribbon; hits lift it into a wave.' },
  { id: 'sparks', name: 'Sparks', note: 'A row of dots; each hit throws them up.' },
  { id: 'skyline', name: 'Skyline', note: 'Stepped blocks like a far city, a floor at a time.' },
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

const AURORA_NAMES: { id: AuroraLevel; name: string; note: string }[] = [
  { id: 'off', name: 'Off', note: 'No aurora veil over the scene; the glow around the video stays' },
  { id: 'soft', name: 'Soft', note: 'The aurora veil at half strength' },
  { id: 'full', name: 'Full', note: 'The aurora veil as it always looks' },
];
const MUSIC_NAMES: { id: MusicLevel; name: string; note: string }[] = [
  { id: 'calm', name: 'Calm', note: 'The hills on the other tabs ripple softly, as they always have' },
  { id: 'medium', name: 'Medium', note: 'More lines, taller and in the cover colours, about 60 percent of Unwind' },
  { id: 'full', name: 'Full', note: 'The other tabs dance as strongly as Unwind' },
];

const GLITCH_NAMES: { id: GlitchLook; name: string; note: string }[] = [
  { id: 'off', name: 'Off', note: 'No glitch on a drop, even with Auto vibe on' },
  { id: 'tear', name: 'Tear', note: 'Slices tear sideways across the picture on a drop' },
  { id: 'split', name: 'Split', note: 'On a drop the colour channels pull apart sideways and a few wide bands shake' },
  { id: 'roll', name: 'Roll', note: 'On a drop a tape tracking band rolls down the screen' },
  { id: 'flash', name: 'Flash', note: 'On a drop a bright bloom washes over the picture with a small zoom punch' },
];
const LENGTH_NAMES: { id: GlitchLength; name: string; note: string }[] = [
  { id: 'short', name: 'Short', note: 'Each hit fades out in half a second' },
  { id: 'normal', name: 'Normal', note: 'Each hit lasts about a second, as it always has' },
  { id: 'long', name: 'Long', note: 'Each hit lingers for about two seconds' },
];
const STRENGTH_NAMES: { id: GlitchStrength; name: string; note: string }[] = [
  { id: 'soft', name: 'Soft', note: 'Each hit is a little over half as strong' },
  { id: 'normal', name: 'Normal', note: 'Each hit is as strong as it always has been' },
  { id: 'hard', name: 'Hard', note: 'Each hit is about half as strong again' },
];
export const MOUNTAIN_NAMES: { id: MountainLevel; name: string; note: string }[] = [
  { id: 'off', name: 'Off', note: 'The mountain lines hold still in their shape, whatever the music does' },
  { id: 'low', name: 'Low', note: 'The music moves the mountain lines half as much as usual' },
  { id: 'medium', name: 'Medium', note: 'The music moves the mountain lines as it always has' },
  { id: 'high', name: 'High', note: 'The music moves the mountain lines half as much again' },
];

/** The full sentence for each setting: shown as a hover tip on its name, with a short hint beside or under the row. */
export const VIBE_HINTS = {
  auto: 'Colour and glow follow how loud the music has been lately.',
  dropGlitch: 'How a big drop hits the picture. A bigger jump in the music hits harder; Off means off, with Auto vibe on or not.',
  tapeGrain: 'A worn tape look: film grain, fine lines and a slow tracking bar over the scene.',
  calmCap: 'Halves every effect, the drop glitch included, and softens the kick and bass; a drop also swells the glow.',
  aurora: 'The soft coloured veil over the scene. The warm glow around the video is separate.',
  offTabMusic: 'How much the music moves the hills on the other tabs.',
  mountain: 'How much the music moves the mountain lines.',
  dropSensitivity: 'How easily the music counts as a drop. Low waits for a big jump after a long calm; high fires on small swells, even in steady music. A beat must still land on it, and drops are at least 8 seconds apart.',
  beatHits: 'A small glitch on the hardest beats: a quarter of a drop, at most every 4 seconds, never within 2 seconds after a drop.',
  glitchLength: 'How long each glitch lasts: Short 0.5 seconds, Normal about a second, Long 2 seconds. It always fades in and out.',
  glitchStrength: 'How hard each glitch is: Soft is 0.6 times, Normal as before, Hard 1.4 times.',
} as const;

/** The short line beside or under a setting. */
export const VIBE_SHORT = {
  auto: 'Glow follows the music',
  calmCap: 'Halves every effect',
  mountain: 'How much the music moves the mountain lines.',
  tapeGrain: 'Grain and fine lines',
  aurora: 'Colour veil',
} as const;

/** The Tools list line for the group: the Mountain dance level read back. */
export const MOUNTAIN_WORD: Record<MountainLevel, string> = { off: 'Off', low: 'Low', medium: 'Medium', high: 'High' };

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

/** One switch row of the Vibe controls: the name (its full sentence on hover), the switch, and a short hint beside it. */
function VibeSwitch({ uid, id, label, on, hint, full, tipText, onToggle, hintRight }: { uid: string; id: string; label: string; on: boolean; hint: string; full: string; tipText: string; onToggle: () => void; hintRight?: boolean }) {
  return (
    <div className="ln-row ln-swrow">
      <span className="ln-label ln-swl" id={`${uid}-${id}-label`} {...tip(full)}>
        {label}
      </span>
      <button type="button" role="switch" aria-checked={on} aria-labelledby={`${uid}-${id}-label`} aria-describedby={`${uid}-${id}-hint`} className={`ln-switch${on ? ' on' : ''}`} {...tip(tipText)} onClick={onToggle}>
        <i aria-hidden="true" />
      </button>
      <span className={`ln-short${hintRight ? ' ln-short-end' : ''}`} id={`${uid}-${id}-hint`}>
        {hint}
      </span>
    </div>
  );
}

/** One chip row of the Vibe controls: the name (its full sentence on hover) and the chips. `hint` is the line under the row, when it has one. */
function VibeChips<T extends string>({ uid, id, label, items, value, full, hint, wide, onPick, trailing }: { uid: string; id: string; label: string; items: { id: T; name: string; note: string }[]; value: T; full: string; hint?: string; wide?: boolean; onPick: (id: T) => void; trailing?: string }) {
  return (
    <>
      <div className="ln-row">
        <span className={`ln-label${wide ? ' ln-wide' : ''}`} id={`${uid}-${id}-label`} {...tip(full)}>
          {label}
        </span>
        <div className="ln-chips" role="radiogroup" aria-labelledby={`${uid}-${id}-label`} aria-describedby={hint ? `${uid}-${id}-hint` : undefined} onKeyDown={arrows(items, value, onPick)}>
          {items.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={value === x.id} tabIndex={value === x.id ? 0 : -1} className={value === x.id ? 'on' : ''} {...tip(x.note)} onClick={() => onPick(x.id)}>
              {x.name}
            </button>
          ))}
        </div>
        {trailing ? <span className="ln-short ln-short-end">{trailing}</span> : null}
      </div>
      {hint ? (
        <p className="ln-hint ln-vhint" id={`${uid}-${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </>
  );
}

const GLITCH_ICONS: Record<GlitchLook, typeof IconBan> = { off: IconBan, tear: IconBaselineDensityMedium, split: IconEqual, roll: IconArrowsExchange, flash: IconFocus2 };

/** The live sound level, a soft bar behind the Drops slider's track. Only this bar re-renders as the music moves. */
function LevelBar() {
  const level = useAudioStore((st) => Math.round(loudness(st) * 50) / 50);
  return <i className="dg-level" aria-hidden="true" style={{ width: `${level * 100}%` }} />;
}

/** The Drops row: a 1 to 10 slider from "big only" to "any lift" with the live level inside its track and the number at the end. */
function DropsRow({ uid, value, onChange }: { uid: string; value: number; onChange: (v: number) => void }) {
  const span = SENSITIVITY_MAX - SENSITIVITY_MIN;
  const style = { '--usual': `${((SENSITIVITY_DEFAULT - SENSITIVITY_MIN) / span) * 100}%`, '--at': `${((value - SENSITIVITY_MIN) / span) * 100}%` } as CSSProperties;
  return (
    <>
      <div className="dg-row">
        <label className="dg-label" htmlFor={`${uid}-sens`} {...tip(VIBE_HINTS.dropSensitivity)}>
          Drops
        </label>
        <span className="ln-track dg-track" style={style}>
          <LevelBar />
          <i className="ln-usual" aria-hidden="true" />
          <input id={`${uid}-sens`} type="range" min={SENSITIVITY_MIN} max={SENSITIVITY_MAX} step={1} value={value} aria-valuetext={`${value} of ${SENSITIVITY_MAX}, from big drops only to any lift`} {...tip('Left fires only on a big jump after a long calm. Right fires on any lift. The soft bar is the sound level now; the mark is your usual.')} onChange={(e) => onChange(Number(e.target.value))} />
        </span>
        <span className="dg-num">{value}</span>
      </div>
      <div className="dg-row dg-scale" aria-hidden="true">
        <span>big only</span>
        <span>any lift</span>
      </div>
    </>
  );
}

/** A segmented control of three choices: one pill, the chosen part lit. */
function Seg<T extends string>({ label, items, value, full, onPick }: { label: string; items: { id: T; name: string; note: string }[]; value: T; full: string; onPick: (id: T) => void }) {
  return (
    <div className="dg-seg" role="radiogroup" aria-label={label} onKeyDown={arrows(items, value, onPick)} {...tip(full)}>
      {items.map((x) => (
        <button key={x.id} type="button" role="radio" aria-checked={value === x.id} tabIndex={value === x.id ? 0 : -1} className={value === x.id ? 'on' : ''} {...tip(x.note)} onClick={() => onPick(x.id)}>
          {x.name}
        </button>
      ))}
    </div>
  );
}

/**
 * The Vibe controls, in two groups: Music reacts and Screen look. The same component serves the Unwind Vibe page and the
 * Tools drawer's Vibe group, both reading the one vibe store, so a change in one shows in the other at once. Its own
 * setting; Reset to my usual on the Lines page leaves it alone. `tuneOpen` is whether "Tune when it fires" starts open: the
 * sheet scrolls and starts it open; the Tools drawer cannot scroll and starts it folded.
 */
export function VibePanel({ tuneOpen = true }: { tuneOpen?: boolean } = {}) {
  const uid = useId();
  const v = useVibeStore();
  const set = v.setVibe;
  // With Drop Glitch Off the settings under it dim and take no input.
  const off = v.dropGlitch === 'off';
  const [open, setOpen] = useState(tuneOpen);
  const beatsOn = v.beatHits === 'light';
  return (
    <div className="ln-panel ln-vibe" role="group" aria-label="Vibe">
      <section className="dg-card" aria-labelledby={`${uid}-dg`}>
        <div className="dg-head">
          <IconBolt size={20} aria-hidden="true" />
          <span className="dg-title" id={`${uid}-dg`} {...tip(VIBE_HINTS.dropGlitch)}>
            Drop Glitch
          </span>
          <button type="button" className="ln-try" disabled={off} {...tip('Fire one hit now with the current look, length and strength, even with no music. It shows on Listen and Watch.')} onClick={fireTry}>
            <IconPlayerPlay size={16} aria-hidden="true" />
            Try it
          </button>
        </div>
        <div className="dg-tiles" role="radiogroup" aria-labelledby={`${uid}-dg`} onKeyDown={arrows(GLITCH_NAMES, v.dropGlitch, (id) => set({ dropGlitch: id }))}>
          {GLITCH_NAMES.map((x) => {
            const Icon = GLITCH_ICONS[x.id];
            return (
              <button key={x.id} type="button" role="radio" aria-checked={v.dropGlitch === x.id} tabIndex={v.dropGlitch === x.id ? 0 : -1} className={v.dropGlitch === x.id ? 'on' : ''} {...tip(x.note)} onClick={() => set({ dropGlitch: x.id })}>
                <Icon size={22} aria-hidden="true" />
                {x.name}
              </button>
            );
          })}
        </div>
        <button type="button" className="dg-fold" aria-expanded={open} aria-controls={`${uid}-tune`} {...tip('Show or hide how easily a drop fires, the beat hits, and how long and how hard each hit is.')} onClick={() => setOpen(!open)}>
          <IconChevronDown size={18} aria-hidden="true" className={open ? '' : 'shut'} />
          Tune when it fires
        </button>
        <div className={`dg-tune${off ? ' off' : ''}`} id={`${uid}-tune`} role="group" aria-label="Tune when it fires" aria-disabled={off} hidden={!open}>
          <fieldset disabled={off} className="dg-set">
            <DropsRow uid={uid} value={v.dropSensitivity} onChange={(n) => set({ dropSensitivity: n })} />
            <div className="dg-row dg-beat">
              <span className="dg-label dg-bl" id={`${uid}-beats-label`} {...tip(VIBE_HINTS.beatHits)}>
                <IconActivity size={18} aria-hidden="true" />
                Beat hits
              </span>
              <span className="dg-help" id={`${uid}-beats-hint`}>
                a light glitch on hard beats
              </span>
              <button type="button" role="switch" aria-checked={beatsOn} aria-labelledby={`${uid}-beats-label`} aria-describedby={`${uid}-beats-hint`} className={`ln-switch${beatsOn ? ' on' : ''}`} {...tip(beatsOn ? 'Light glitches on the hardest beats are on. Click to turn them off.' : 'Click for a small glitch on the hardest beats, at most every 4 seconds.')} onClick={() => set({ beatHits: beatsOn ? 'off' : 'light' })}>
                <i aria-hidden="true" />
              </button>
            </div>
            <div className="dg-row dg-each">
              <span className="dg-label" {...tip('How long and how hard each glitch is, for a drop, a beat hit and Try it.')}>
                Each hit
              </span>
              <Seg label="Length" items={LENGTH_NAMES} value={v.glitchLength} full={VIBE_HINTS.glitchLength} onPick={(id) => set({ glitchLength: id })} />
            </div>
            <div className="dg-row dg-each">
              <span className="dg-label" aria-hidden="true" />
              <Seg label="Strength" items={STRENGTH_NAMES} value={v.glitchStrength} full={VIBE_HINTS.glitchStrength} onPick={(id) => set({ glitchStrength: id })} />
            </div>
          </fieldset>
        </div>
      </section>
      <div className="ln-row ln-head">
        <span className="ln-gh">Music reacts</span>
        <button type="button" className="ln-reset" {...tip('The vibe settings back to your usual: Auto vibe on, Tear, drop sensitivity 3, Medium mountain dance and music on other tabs, the rest off, Full aurora')} onClick={v.reset}>
          <IconRestore size={16} aria-hidden="true" />
          Reset vibe
        </button>
      </div>
      <VibeSwitch
        uid={uid}
        id="auto"
        label="Auto vibe"
        on={v.auto}
        hint={VIBE_SHORT.auto}
        full={VIBE_HINTS.auto}
        tipText={v.auto ? 'Colour and glow follow the music. Click to turn it off.' : 'Every effect sits at a fixed level. Click to follow the music.'}
        onToggle={() => set({ auto: !v.auto })}
      />
      <VibeChips uid={uid} id="mountain" label="Mountain dance" items={MOUNTAIN_NAMES} value={v.mountain} full={VIBE_HINTS.mountain} hint={VIBE_SHORT.mountain} onPick={(id) => set({ mountain: id })} />
      <VibeSwitch
        uid={uid}
        id="calm"
        label="Calm cap"
        on={v.calmCap}
        hint={VIBE_SHORT.calmCap}
        full={VIBE_HINTS.calmCap}
        tipText={v.calmCap ? 'Effects are halved. Click to turn it off.' : 'Click to halve every effect.'}
        onToggle={() => set({ calmCap: !v.calmCap })}
      />
      <VibeChips uid={uid} id="music" label="Music on other tabs" wide items={MUSIC_NAMES} value={v.offTabMusic} full={VIBE_HINTS.offTabMusic} onPick={(id) => set({ offTabMusic: id })} />
      <div className="ln-row ln-head ln-split">
        <span className="ln-gh">Screen look</span>
      </div>
      <VibeSwitch
        uid={uid}
        id="tape"
        label="Tape Grain"
        on={v.tapeGrain}
        hint={VIBE_SHORT.tapeGrain}
        full={VIBE_HINTS.tapeGrain}
        tipText={v.tapeGrain ? 'Grain, lines and a tracking bar are on. Click to turn them off.' : 'Click for film grain, fine lines and a slow tracking bar.'}
        onToggle={() => set({ tapeGrain: !v.tapeGrain })}
      />
      <VibeChips uid={uid} id="aurora" label="Aurora" items={AURORA_NAMES} value={v.aurora} full={VIBE_HINTS.aurora} trailing={VIBE_SHORT.aurora} onPick={(id) => set({ aurora: id })} />
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
        <button type="button" className="ln-reset" {...tip('Every lines setting back to your usual: Mountains, 50, 50, 104 px, from the look, reflection on, ridge at rest')} onClick={s.reset}>
          <IconRestore size={16} aria-hidden="true" />
          Reset to my usual
        </button>
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
        <span className="ln-value ln-fill">{colours.name}</span>
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
        <span className="ln-value ln-fill">{preset === 'dancing' ? 'your usual' : preset ? '' : 'your own mix'}</span>
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
      {...tip('How the music shows: lines, and the lights (colour, brightness, flash) in Lights')}
      onClick={() => useWatchStore.getState().setSheet(!open)}
    >
      <IconSettings size={26} aria-hidden="true" />
    </button>
  );
}
