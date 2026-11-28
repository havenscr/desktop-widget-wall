import { create } from 'zustand';
import { SENS_DEFAULT, SENS_MAX, SENS_MIN } from '../audio/energy';
import { DEFAULT_MUSIC_LEVEL, MUSIC_LEVELS, type MusicLevel } from './offTabMusic';

/** The aurora veil over the scene: off, half strength, or the full look. */
export type AuroraLevel = 'off' | 'soft' | 'full';
export const AURORA_LEVELS: AuroraLevel[] = ['off', 'soft', 'full'];

/** What a drop does to the picture: nothing, slices tear across it, the colours pull apart, a tape band rolls down it, or a bright bloom. */
export type GlitchLook = 'off' | 'tear' | 'split' | 'roll' | 'flash';
export const GLITCH_LOOKS: GlitchLook[] = ['off', 'tear', 'split', 'roll', 'flash'];

/** How much the music moves the mountain lines: still, half, today's look, or half as much again. */
export type MountainLevel = 'off' | 'low' | 'medium' | 'high';
export const MOUNTAIN_LEVELS: MountainLevel[] = ['off', 'low', 'medium', 'high'];
/** The factor on the ridge's dance height for each level. */
export const MOUNTAIN_GAIN: Readonly<Record<MountainLevel, number>> = { off: 0, low: 0.5, medium: 1, high: 1.5 };

/** Small glitches on the hardest beats: off (today), or Light. */
export type BeatHits = 'off' | 'light';
export const BEAT_HITS: BeatHits[] = ['off', 'light'];
/** How long a hit lasts: Short 0.5 s, Normal 0.95 s (today), Long 2 s. */
export type GlitchLength = 'short' | 'normal' | 'long';
export const GLITCH_LENGTHS: GlitchLength[] = ['short', 'normal', 'long'];
export const GLITCH_LENGTH_S: Readonly<Record<GlitchLength, number>> = { short: 0.5, normal: 0.95, long: 2 };
/** How hard a hit is: Soft 0.6 times, Normal today's amount, Hard 1.4 times. */
export type GlitchStrength = 'soft' | 'normal' | 'hard';
export const GLITCH_STRENGTHS: GlitchStrength[] = ['soft', 'normal', 'hard'];
export const GLITCH_STRENGTH_GAIN: Readonly<Record<GlitchStrength, number>> = { soft: 0.6, normal: 1, hard: 1.4 };
/** Sensitivity slider range and default (3 is the drop rule the wall always had). */
export const SENSITIVITY_MIN = SENS_MIN;
export const SENSITIVITY_MAX = SENS_MAX;
export const SENSITIVITY_DEFAULT = SENS_DEFAULT;

export interface VibeSettings {
  /** Colour, glow and the mix follow how loud the music has been lately (on), or sit at fixed levels (off). */
  auto: boolean;
  /** What a drop does to the picture. Off means off, with Auto vibe on or not. */
  dropGlitch: GlitchLook;
  /** Film grain, scanlines and a slow tracking bar. */
  tapeGrain: boolean;
  /** Halves the strength of every effect, the drop glitch included. */
  calmCap: boolean;
  /** The aurora veil's strength. Bass Glow is separate and not affected. */
  aurora: AuroraLevel;
  /** How strongly the music moves the ridgelines on every tab but Unwind (Work, Home, Meet, On Air, Shelf). */
  offTabMusic: MusicLevel;
  /** How much the music moves the mountain lines, on every tab. */
  mountain: MountainLevel;
  /** How easily a drop fires, 1 (strict) to 10 (loose). */
  dropSensitivity: number;
  /** A small glitch on the hardest beats. */
  beatHits: BeatHits;
  /** How long each hit lasts. */
  glitchLength: GlitchLength;
  /** How hard each hit is. */
  glitchStrength: GlitchStrength;
}

/** Auto vibe on; the rest off. The effects run on Listen and Watch, under every word. A `cover` saved by an older build is ignored on load and dropped on the next save. */
export const DEFAULT_VIBE: Readonly<VibeSettings> = {
  auto: true, dropGlitch: 'tear', tapeGrain: false, calmCap: false, aurora: 'full', offTabMusic: DEFAULT_MUSIC_LEVEL, mountain: 'medium',
  dropSensitivity: SENSITIVITY_DEFAULT, beatHits: 'off', glitchLength: 'normal', glitchStrength: 'normal',
};
/** Its own store, so a Lines reset or preset never touches the vibe. */
export const VIBE_KEY = 'wall2-vibe';

const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** A stored Drop Glitch: a look, or the old switch (on is Tear; off is Tear while Auto vibe is on, else Off); anything else is the default. */
export function glitchOf(v: unknown, auto: boolean = DEFAULT_VIBE.auto): GlitchLook {
  if (v === true) return 'tear';
  // Auto vibe used to force the glitch on, so an old off with Auto vibe on was seen as Tear.
  if (v === false) return auto ? 'tear' : 'off';
  return GLITCH_LOOKS.includes(v as GlitchLook) ? (v as GlitchLook) : DEFAULT_VIBE.dropGlitch;
}

/** A stored Sensitivity: a whole number 1 to 10, else the default. */
export function sensitivityOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, Math.round(v))) : SENSITIVITY_DEFAULT;
}

export function validateVibe(value: unknown): VibeSettings {
  const v = value && typeof value === 'object' ? (value as Partial<Record<keyof VibeSettings, unknown>>) : {};
  const auto = flag(v.auto, DEFAULT_VIBE.auto);
  return {
    auto,
    dropGlitch: glitchOf(v.dropGlitch, auto),
    tapeGrain: flag(v.tapeGrain, DEFAULT_VIBE.tapeGrain),
    calmCap: flag(v.calmCap, DEFAULT_VIBE.calmCap),
    aurora: AURORA_LEVELS.includes(v.aurora as AuroraLevel) ? (v.aurora as AuroraLevel) : DEFAULT_VIBE.aurora,
    offTabMusic: MUSIC_LEVELS.includes(v.offTabMusic as MusicLevel) ? (v.offTabMusic as MusicLevel) : DEFAULT_VIBE.offTabMusic,
    mountain: MOUNTAIN_LEVELS.includes(v.mountain as MountainLevel) ? (v.mountain as MountainLevel) : DEFAULT_VIBE.mountain,
    dropSensitivity: sensitivityOf(v.dropSensitivity),
    beatHits: BEAT_HITS.includes(v.beatHits as BeatHits) ? (v.beatHits as BeatHits) : DEFAULT_VIBE.beatHits,
    glitchLength: GLITCH_LENGTHS.includes(v.glitchLength as GlitchLength) ? (v.glitchLength as GlitchLength) : DEFAULT_VIBE.glitchLength,
    glitchStrength: GLITCH_STRENGTHS.includes(v.glitchStrength as GlitchStrength) ? (v.glitchStrength as GlitchStrength) : DEFAULT_VIBE.glitchStrength,
  };
}

/** The stored setting, validated; the defaults when nothing (or nothing readable) is stored. */
function load(): VibeSettings {
  try {
    return validateVibe(JSON.parse(localStorage.getItem(VIBE_KEY) || 'null'));
  } catch {
    return { ...DEFAULT_VIBE };
  }
}
function save(value: VibeSettings): void {
  try {
    localStorage.setItem(VIBE_KEY, JSON.stringify(value));
  } catch {
    // Storage may be unavailable: the setting then lasts until the wall restarts.
  }
}

interface VibeStore extends VibeSettings {
  setVibe: (next: Partial<VibeSettings>) => void;
  reset: () => void;
}

export const useVibeStore = create<VibeStore>((set) => ({
  ...load(),
  setVibe: (next) =>
    set((state) => {
      const value = validateVibe({ ...state, ...next });
      save(value);
      return value;
    }),
  reset: () =>
    set(() => {
      const value = { ...DEFAULT_VIBE };
      save(value);
      return value;
    }),
}));

const pick = (v: VibeSettings): VibeSettings => ({
  auto: v.auto, dropGlitch: v.dropGlitch, tapeGrain: v.tapeGrain, calmCap: v.calmCap, aurora: v.aurora, offTabMusic: v.offTabMusic, mountain: v.mountain,
  dropSensitivity: v.dropSensitivity, beatHits: v.beatHits, glitchLength: v.glitchLength, glitchStrength: v.glitchStrength,
});
// The settings alone (no actions), rebuilt only when they change, so a frame reads them for free.
let current = pick(useVibeStore.getState());
useVibeStore.subscribe((state) => {
  current = pick(state);
});

/** The settings as the frame reads them, never through a render. Do not mutate the result. */
export const vibeSettings = (): Readonly<VibeSettings> => current;

/** Tests: read the stored setting again. */
export function resetVibeStore(): void {
  useVibeStore.setState({ ...load() });
}
