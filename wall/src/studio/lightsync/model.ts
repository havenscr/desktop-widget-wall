/**
 * Music light sync, front end model: what the page sends to `wall2_lightsync_start` and `_tune`.
 * Rust holds no palette table; it validates and clamps what arrives (`engine.rs`). The clamps here
 * mirror `Settings::from_in` there so the page never shows a value the native side would change.
 */

export interface LightPalette {
  id: string;
  name: string;
  /** 2 to 6 colours, `#rrggbb`, cycled. */
  colors: string[];
  /** Flash colour on a kick. */
  kick: string;
  /** Colour at the floor (silence). */
  rest: string;
}

export interface LightSyncSettings {
  brightness: number;
  floor: number;
  bassGain: number;
  highGain: number;
  kickFlash: number;
  attackMs: number;
  releaseMs: number;
  beatStep: boolean;
  rippleMs: number;
  plays: boolean;
  panels: boolean;
  sendHz: number;
  /** How much of the span between floor and peak the sound's level moves (0 to 1). */
  energyDepth: number;
  /** How far a pulse mixes toward the palette's kick colour; 0 is no white. */
  kickWhite: number;
  kickRiseMs: number;
  kickDecayMs: number;
  /** Frames of 33 ms the band levels are averaged over before they are followed. */
  levelWindow: number;
  /** Colours a beat nudges the palette along. */
  beatNudge: number;
  /** Beats closer than this do not restart a pulse's brightness. */
  minPulseGapMs: number;
  /** The fastest brightness fall, per second. */
  slewDown: number;
}

/** The intensity choices. The page owns the table; the native side only clamps (`engine.rs`). */
export type IntensityId = 'subtle' | 'moderate' | 'high';
export const INTENSITY_IDS: readonly IntensityId[] = ['subtle', 'moderate', 'high'];

/** Every setting an intensity rewrites, plus the colour speed it uses (`colourBars`, which sets the drift). */
export const INTENSITIES: Record<IntensityId, { settings: Pick<LightSyncSettings, 'floor' | 'brightness' | 'energyDepth' | 'kickFlash' | 'kickWhite' | 'kickRiseMs' | 'kickDecayMs' | 'attackMs' | 'releaseMs' | 'levelWindow' | 'beatNudge' | 'minPulseGapMs' | 'slewDown'>; colourBars: number }> = {
  subtle: { settings: { floor: 0.35, brightness: 0.8, energyDepth: 0.35, kickFlash: 0.25, kickWhite: 0, kickRiseMs: 80, kickDecayMs: 450, attackMs: 150, releaseMs: 900, levelWindow: 8, beatNudge: 0.04, minPulseGapMs: 500, slewDown: 0.8 }, colourBars: 4 },
  moderate: { settings: { floor: 0.25, brightness: 0.9, energyDepth: 0.55, kickFlash: 0.45, kickWhite: 0.15, kickRiseMs: 60, kickDecayMs: 320, attackMs: 100, releaseMs: 650, levelWindow: 4, beatNudge: 0.08, minPulseGapMs: 400, slewDown: 1.5 }, colourBars: 2 },
  high: { settings: { floor: 0.15, brightness: 1, energyDepth: 0.75, kickFlash: 0.7, kickWhite: 0.35, kickRiseMs: 40, kickDecayMs: 220, attackMs: 60, releaseMs: 420, levelWindow: 2, beatNudge: 0.15, minPulseGapMs: 340, slewDown: 3 }, colourBars: 1 },
};

export const DEFAULT_INTENSITY: IntensityId = 'subtle';

export const DEFAULT_LIGHT_SYNC: LightSyncSettings = {
  ...INTENSITIES.subtle.settings,
  bassGain: 1,
  highGain: 1,
  beatStep: true,
  rippleMs: 600,
  plays: true,
  panels: true,
  sendHz: 50,
};

/** Milliseconds the palette takes to move one colour, for each stop of `COLOUR_BARS` (slow to fast). */
export const DRIFT_MS: readonly number[] = [20000, 14000, 10000, 6000, 3000];

/**
 * The Lights tab's colour speed, who follows and ripple. The page keeps them beside the settings and sends them with
 * every `start` and `tune` as `colourBars`, `follow` and `ripple` (`engine.rs`).
 */
export type Follow = 'bass' | 'highs' | 'both';
export const FOLLOWS: readonly Follow[] = ['bass', 'highs', 'both'];
/** The lights, left to right: the four Plays, then the panels. */
export const LIGHT_NAMES = ['Far Left', 'Left', 'Right', 'Far Right', 'Panels'] as const;
/** Bars between colour changes, slow to fast. */
export const COLOUR_BARS: readonly number[] = [8, 6, 4, 2, 1];

export interface LightsUi {
  /** Bars the lights stay on one colour. */
  colourBars: number;
  follow: Follow[];
  ripple: boolean;
}

export const DEFAULT_LIGHTS_UI: LightsUi = { colourBars: INTENSITIES.subtle.colourBars, follow: ['highs', 'bass', 'bass', 'highs', 'both'], ripple: true };

export function clampUi(raw: unknown): LightsUi {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const follow = Array.isArray(r.follow) && r.follow.length === 5 && r.follow.every((f) => FOLLOWS.includes(f as Follow)) ? (r.follow as Follow[]).slice() : DEFAULT_LIGHTS_UI.follow.slice();
  return {
    colourBars: typeof r.colourBars === 'number' && COLOUR_BARS.includes(r.colourBars) ? r.colourBars : DEFAULT_LIGHTS_UI.colourBars,
    follow,
    ripple: typeof r.ripple === 'boolean' ? r.ripple : DEFAULT_LIGHTS_UI.ripple,
  };
}

/** Milliseconds per colour for a colour speed. */
export function driftOf(colourBars: number): number {
  const at = COLOUR_BARS.indexOf(colourBars);
  return DRIFT_MS[at < 0 ? COLOUR_BARS.indexOf(DEFAULT_LIGHTS_UI.colourBars) : at];
}

/** The settings object the native side takes: the engine fields plus the Lights tab's three. */
export function engineSettings(settings: LightSyncSettings, ui: LightsUi): Record<string, unknown> {
  return { ...settings, colourBars: ui.colourBars, driftMs: driftOf(ui.colourBars), follow: { plays: ui.follow.slice(0, 4), panels: ui.follow[4] }, ripple: ui.ripple };
}

/** The native side's ranges (`Settings::from_in`). `floor` is also held 0.1 under `brightness`. */
const RANGES: Record<Exclude<keyof LightSyncSettings, 'beatStep' | 'plays' | 'panels'>, [number, number]> = {
  brightness: [0.2, 1],
  floor: [0.05, 0.6],
  bassGain: [0, 2],
  highGain: [0, 2],
  kickFlash: [0, 1],
  attackMs: [40, 400],
  releaseMs: [200, 2000],
  rippleMs: [200, 1500],
  sendHz: [25, 60],
  energyDepth: [0, 1],
  kickWhite: [0, 0.5],
  kickRiseMs: [30, 200],
  kickDecayMs: [150, 1000],
  levelWindow: [1, 12],
  beatNudge: [0, 0.25],
  minPulseGapMs: [340, 1000],
  slewDown: [0.3, 5],
};

function num(v: unknown, key: keyof typeof RANGES): number {
  const [lo, hi] = RANGES[key];
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULT_LIGHT_SYNC[key];
}

/** Every value clamped; a missing or odd one takes the default. */
export function clampSettings(raw: unknown): LightSyncSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const brightness = num(s.brightness, 'brightness');
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    brightness,
    floor: Math.min(num(s.floor, 'floor'), brightness - 0.1),
    bassGain: num(s.bassGain, 'bassGain'),
    highGain: num(s.highGain, 'highGain'),
    kickFlash: num(s.kickFlash, 'kickFlash'),
    attackMs: num(s.attackMs, 'attackMs'),
    releaseMs: num(s.releaseMs, 'releaseMs'),
    beatStep: bool(s.beatStep, DEFAULT_LIGHT_SYNC.beatStep),
    rippleMs: num(s.rippleMs, 'rippleMs'),
    plays: bool(s.plays, DEFAULT_LIGHT_SYNC.plays),
    panels: bool(s.panels, DEFAULT_LIGHT_SYNC.panels),
    sendHz: num(s.sendHz, 'sendHz'),
    energyDepth: num(s.energyDepth, 'energyDepth'),
    kickWhite: num(s.kickWhite, 'kickWhite'),
    kickRiseMs: num(s.kickRiseMs, 'kickRiseMs'),
    kickDecayMs: num(s.kickDecayMs, 'kickDecayMs'),
    levelWindow: Math.round(num(s.levelWindow, 'levelWindow')),
    beatNudge: num(s.beatNudge, 'beatNudge'),
    minPulseGapMs: num(s.minPulseGapMs, 'minPulseGapMs'),
    slewDown: num(s.slewDown, 'slewDown'),
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);

export const SYNTHWAVE: LightPalette = {
  id: 'synthwave',
  name: 'Synthwave',
  colors: ['#ff3d9a', '#35e6ea', '#9a7bff'],
  kick: '#ffffff',
  rest: '#2a0f5a',
};

/** The ids of the eight palettes, in the strip's order. */
export type PaletteId = 'synthwave' | 'album' | 'sky' | 'mood' | 'sheep' | 'neon' | 'zen' | 'custom';

export interface PaletteEntry {
  id: PaletteId;
  name: string;
  /** What the strip's swatch shows when nothing live is known. */
  swatch: string[];
  /** One line for the tip. */
  tip: string;
  /** False: shown, greyed, never picked. */
  enabled: boolean;
}

export const PALETTES: readonly PaletteEntry[] = [
  { id: 'synthwave', name: 'Synthwave', swatch: SYNTHWAVE.colors, tip: 'The wall horizon: magenta, cyan and violet.', enabled: true },
  { id: 'album', name: 'Album art', swatch: ['#ff3d9a', '#9a7bff'], tip: 'The colours of the cover now playing, as the dancing lines take them. With no cover playing it uses Synthwave.', enabled: true },
  { id: 'sky', name: 'Wall sky', swatch: ['#9a7bff', '#4fc3f7'], tip: "The wall's own colours.", enabled: true },
  { id: 'mood', name: 'Office mood', swatch: ['#ffb975', '#ff8a4d'], tip: 'The colours of the office mood that was on before sync.', enabled: true },
  { id: 'sheep', name: 'Electric Sheep', swatch: ['#ff7a1a', '#ffc24d', '#9a7bff', '#4f6bff'], tip: 'Fire orange and gold curling into violet and electric blue.', enabled: true },
  { id: 'neon', name: 'Neon City', swatch: ['#ff2e93', '#35e6ea', '#ffe14d', '#5df2b6'], tip: 'Hot pink, cyan and sign yellow with a flash of green.', enabled: true },
  { id: 'zen', name: 'Zen Tide', swatch: ['#4fd1c5', '#6b8fb8', '#b9a8f0'], tip: 'Calm sea glass: teal, slate blue and lavender.', enabled: true },
  { id: 'custom', name: 'Your own', swatch: [], tip: 'Your own colours: keep the cover now playing, or pick from swatches. Click to choose them.', enabled: true },
];

export const DEFAULT_PALETTE: PaletteId = 'synthwave';
export const isPaletteId = (v: unknown): v is PaletteId => PALETTES.some((p) => p.id === v);

/** Your own colours: 3 to 5. */
export const CUSTOM_MIN = 3;
export const CUSTOM_MAX = 5;

/** The 24 swatches that suit the wall. */
export const SWATCHES: readonly string[] = [
  '#ff3d9a', '#ff7ac8', '#ff2e6e', '#ff7a1a', '#ffb975', '#ffc24d', '#ffe14d', '#5df2b6', '#00ff9d', '#2ec4b6', '#35e6ea', '#4fc3f7',
  '#4f6bff', '#3b4cff', '#7a80ff', '#9a7bff', '#b9a8f0', '#c77dff', '#e040fb', '#8a2be2', '#ff6b6b', '#f4a261', '#a0e7e5', '#fdf0d5',
];

/** Saved custom colours, each checked, lower case, no repeats, at most five; fewer than three is kept as is (the picker is mid-way). */
export function clampCustom(raw: unknown): string[] {
  const out: string[] = [];
  for (const c of Array.isArray(raw) ? raw : []) if (isHex(c) && !out.includes(c.toLowerCase())) out.push(c.toLowerCase());
  return out.slice(0, CUSTOM_MAX);
}

const rgbOf = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Fewer than `CUSTOM_MIN` colours (a flat cover) are filled up with the swatches nearest to the ones kept, nearest first. */
export function padToMinimum(colours: readonly string[]): string[] {
  const out = clampCustom(colours);
  const dist = (a: string, b: string) => rgbOf(a).reduce((t, v, i) => t + (v - rgbOf(b)[i]) ** 2, 0);
  while (out.length < CUSTOM_MIN && out.length > 0) {
    const next = SWATCHES.filter((w) => !out.includes(w)).sort((x, y) => Math.min(...out.map((o) => dist(x, o))) - Math.min(...out.map((o) => dist(y, o))))[0];
    out.push(next);
  }
  return out;
}

/** What the live palettes follow. Any may be missing. */
export interface PaletteContext {
  /** Your own colours. */
  custom?: readonly string[] | null;
  /** Colours read from the cover now playing (when a reader exists). */
  cover?: readonly string[] | null;
  /** The wall's own colours. */
  sky?: readonly string[] | null;
  /** The dot colours of the office mood that was on at start. */
  mood?: readonly string[] | null;
}

const SKY = ['#9a7bff', '#7a80ff', '#4fc3f7'];

const FIXED: Record<'sheep' | 'neon' | 'zen', Omit<LightPalette, 'id' | 'name'>> = {
  sheep: { colors: ['#ff7a1a', '#ffc24d', '#9a7bff', '#4f6bff'], kick: '#fff2d0', rest: '#2a1040' },
  neon: { colors: ['#ff2e93', '#35e6ea', '#ffe14d', '#5df2b6'], kick: '#ffffff', rest: '#1a0f40' },
  zen: { colors: ['#4fd1c5', '#6b8fb8', '#b9a8f0'], kick: '#e8fffb', rest: '#10284a' },
};

function usable(c: readonly string[] | null | undefined): string[] | null {
  const ok = (c ?? []).filter(isHex).slice(0, 6);
  if (ok.length === 1) return [ok[0], ok[0]];
  return ok.length >= 2 ? ok : null;
}

/** The palette the page sends for an id. Never empty: a palette with no usable colours falls back to Synthwave. */
export function resolvePalette(id: PaletteId, ctx: PaletteContext = {}): LightPalette {
  const entry = PALETTES.find((p) => p.id === id);
  const name = entry?.name ?? SYNTHWAVE.name;
  switch (id) {
    case 'album': {
      const c = usable(ctx.cover);
      return c ? { id, name, colors: c, kick: '#ffffff', rest: SYNTHWAVE.rest } : { ...SYNTHWAVE, id, name };
    }
    case 'sky':
      return { id, name, colors: usable(ctx.sky) ?? SKY, kick: '#ffffff', rest: SYNTHWAVE.rest };
    case 'mood': {
      const c = usable(ctx.mood);
      return c ? { id, name, colors: c, kick: '#ffffff', rest: '#1f1a30' } : { ...SYNTHWAVE, id, name };
    }
    case 'custom': {
      const c = usable(ctx.custom);
      return c && c.length >= CUSTOM_MIN ? { id, name, colors: c, kick: '#ffffff', rest: SYNTHWAVE.rest } : { ...SYNTHWAVE, id, name };
    }
    case 'sheep':
    case 'neon':
    case 'zen':
      return { id, name, ...FIXED[id] };
    default:
      return SYNTHWAVE;
  }
}

/** What the native status answers (`LightSyncStatus`). Never a key or an address. */
export interface LightSyncStatus {
  paired: boolean;
  bridgeChanged: boolean;
  running: boolean;
  starting: boolean;
  lastError: string | null;
  stoppedHueSync: boolean;
}

/** The words of a failed start, in plain text for the chip's tip. */
export function failText(word: string): string {
  switch (word) {
    case 'not-paired':
      return 'Not paired with the Hue bridge yet. Pair it in Tools.';
    case 'hue-sync-would-not-stop':
      return 'Hue Sync would not stop. Close it, then try again.';
    case 'bridge-unreachable':
      return 'The Hue bridge did not answer.';
    case 'no-area':
      return 'No entertainment area was found for the desk.';
    case 'panels-unavailable':
      return 'The panels did not answer; the Plays are syncing.';
    case 'busy':
      return 'Another light step is running. Try again in a moment.';
    case 'dtls':
      return 'The link to the lights was lost.';
    default:
      return 'Music sync could not start.';
  }
}
