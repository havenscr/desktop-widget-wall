import { DEFAULT_ZEN_MODE, isZenMode, type ZenMode } from '../zen/modes';
import { CUSTOM_MIN, DEFAULT_INTENSITY, DEFAULT_LIGHT_SYNC, INTENSITIES, INTENSITY_IDS, DEFAULT_PALETTE, clampCustom, clampSettings, clampUi, isPaletteId, sameAsPreset, type IntensityId, type PresetValues, type LightSyncSettings, type LightsUi, type PaletteId } from '../studio/lightsync/model';

/** Wall 2 settings, read from localStorage. No settings screen yet. */
export const SETTINGS_KEY = 'wall2-settings';

export interface Settings {
  latitude: number;
  longitude: number;
  /** Zen dims by itself from this local hour (18 to 23) until 6 AM, once the wall has been quiet. */
  zenDimHour: number;
  /** Quiet minutes on the wall (1 to 60) before Zen dims by itself. */
  zenDimWaitMin: number;
  /** The Zen mode picked last (Breath or Sundown). */
  zenMode: ZenMode;
  /** Sundown also steps the Office lights down while it runs. Off unless turned on. */
  zenSundownLights: boolean;
  /** Names of the task app lists the Shelf place offers (the wall has no route that lists them). */
  shelfLists: string[];
}

export const DEFAULT_SETTINGS: Settings = { latitude: 47.68, longitude: -122.21, zenDimHour: 22, zenDimWaitMin: 10, zenMode: DEFAULT_ZEN_MODE, zenSundownLights: false, shelfLists: [] };

function validInt(v: unknown, min: number, max: number): v is number {
  return validNumber(v, min, max) && Number.isInteger(v);
}

function validNumber(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

/** Saved values override the defaults field by field; bad values are ignored. */
export function loadSettings(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Settings {
  const out = { ...DEFAULT_SETTINGS };
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return out;
    const saved = JSON.parse(raw) as Record<string, unknown> | null;
    if (saved && typeof saved === 'object') {
      if (validNumber(saved.latitude, -90, 90)) out.latitude = saved.latitude;
      if (validNumber(saved.longitude, -180, 180)) out.longitude = saved.longitude;
      if (validInt(saved.zenDimHour, 18, 23)) out.zenDimHour = saved.zenDimHour;
      if (validInt(saved.zenDimWaitMin, 1, 60)) out.zenDimWaitMin = saved.zenDimWaitMin;
      if (isZenMode(saved.zenMode)) out.zenMode = saved.zenMode;
      if (typeof saved.zenSundownLights === 'boolean') out.zenSundownLights = saved.zenSundownLights;
      if (Array.isArray(saved.shelfLists)) {
        // The same rule as the native list-name check (`valid_list_name` in wall2_feeds.rs): 1 to 60 characters
        // after trimming, no control characters. Duplicates are dropped after trimming.
        const clean = saved.shelfLists
          .filter((n): n is string => typeof n === 'string')
          .map((n) => n.trim())
          .filter((n) => n.length > 0 && [...n].length <= 60 && !/\p{Cc}/u.test(n));
        out.shelfLists = [...new Set(clean)].slice(0, 8);
      }
    }
  } catch {
    /* unreadable settings: use defaults */
  }
  return out;
}

/** Saves one or more settings next to the others already stored (unknown keys are kept). A blocked store keeps the choice until the page closes. */
export function saveSettings(patch: Partial<Pick<Settings, 'zenMode' | 'zenSundownLights'>>, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): void {
  try {
    if (!storage) return;
    let saved: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(storage.getItem(SETTINGS_KEY) ?? '{}') as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed as Record<string, unknown>;
    } catch {
      /* unreadable: start from nothing */
    }
    storage.setItem(SETTINGS_KEY, JSON.stringify({ ...saved, ...patch }));
  } catch {
    /* a full or blocked store */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The per-PC light sync choice: the palette last picked and the tuning (`wall2.lightsync`). */
export const LIGHT_SYNC_KEY = 'wall2.lightsync';
/** The saved shape: 3 has presets with saved values and Sensitivity apart from them; 2 was the pulse engine with the old floors. A value without it was saved by the strobe engine. */
export const LIGHT_SYNC_VERSION = 3;

/** The floors the built-in presets had before version 3 (every other value is unchanged). */
const OLD_FLOORS: Record<IntensityId, number> = { subtle: 0.35, moderate: 0.25, high: 0.15 };

export interface LightSyncChoice {
  palette: PaletteId;
  settings: LightSyncSettings;
  /** The Lights tab's page-only choices (colour speed, who follows, ripple). */
  ui: LightsUi;
  /** Your own colours (3 to 5 once used; fewer while being picked). */
  custom: string[];
}

/** Saved values, each checked; a missing, odd or unreadable one (a throwing `localStorage` too) takes the default. */
export function loadLightSync(storage: Pick<Storage, 'getItem'> | null = safeStorage()): LightSyncChoice {
  const out: LightSyncChoice = { palette: DEFAULT_PALETTE, settings: { ...DEFAULT_LIGHT_SYNC }, ui: clampUi(null), custom: [] };
  try {
    const raw = storage?.getItem(LIGHT_SYNC_KEY);
    if (!raw) return out;
    const saved = JSON.parse(raw) as Record<string, unknown> | null;
    if (saved && typeof saved === 'object') {
      out.custom = clampCustom(saved.custom);
      // Your own palette is restored only with its three colours at least.
      if (isPaletteId(saved.palette) && (saved.palette !== 'custom' || out.custom.length >= CUSTOM_MIN)) out.palette = saved.palette;
      out.settings = clampSettings(saved.settings);
      out.ui = clampUi(saved.ui);
      const version = typeof saved.version === 'number' ? saved.version : 0;
      if (version < LIGHT_SYNC_VERSION) {
        if (version < 2) {
          // Saved by the strobe engine: its floor, flash and smoothness are not the gentle look, so move to Subtle once.
          // The palette, your own colours, who follows each light and the ripple stay; so do the lights on or off and the gains.
          const subtle = INTENSITIES[DEFAULT_INTENSITY];
          out.settings = { ...out.settings, ...subtle.settings };
          out.ui = { ...out.ui, colourBars: subtle.colourBars, preset: DEFAULT_INTENSITY, saved: {} };
        } else {
          // Version 2: exactly an old built-in preset moves to that preset's new values; anything else is kept as your own values
          // on the preset with the nearest old floor, so nothing is lost and no edited dot shows.
          const old = (id: IntensityId): PresetValues => ({ settings: { ...INTENSITIES[id].settings, floor: OLD_FLOORS[id] }, colourBars: INTENSITIES[id].colourBars });
          const exact = INTENSITY_IDS.find((id) => sameAsPreset(out.settings, out.ui, old(id)));
          if (exact) {
            out.settings = { ...out.settings, ...INTENSITIES[exact].settings };
            out.ui = clampUi({ ...out.ui, colourBars: INTENSITIES[exact].colourBars, preset: exact, saved: {} });
          } else {
            const nearest = INTENSITY_IDS.reduce((a, b) => (Math.abs(OLD_FLOORS[b] - out.settings.floor) < Math.abs(OLD_FLOORS[a] - out.settings.floor) ? b : a));
            const mine = {} as PresetValues['settings'];
            for (const k of Object.keys(INTENSITIES[nearest].settings) as (keyof PresetValues['settings'])[]) (mine as Record<string, number>)[k] = out.settings[k] as number;
            out.ui = clampUi({ ...out.ui, preset: nearest, saved: { [nearest]: { settings: mine, colourBars: out.ui.colourBars } } });
          }
        }
        // Sensitivity is one slider: two different band gains (old data) become their mean, inside the slider's 0.4 to 1.6.
        const gain = Math.round(Math.min(1.6, Math.max(0.4, (out.settings.bassGain + out.settings.highGain) / 2)) * 100) / 100;
        out.settings = { ...out.settings, bassGain: gain, highGain: gain };
        // Saved at once, so the move happens on one launch only.
        if (storage && 'setItem' in storage) saveLightSync(out, storage as Pick<Storage, 'setItem'>);
      }
    }
  } catch {
    /* unreadable: use the defaults */
  }
  return out;
}

export function saveLightSync(choice: LightSyncChoice, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(LIGHT_SYNC_KEY, JSON.stringify({ ...choice, version: LIGHT_SYNC_VERSION }));
  } catch {
    /* a full or blocked store: the choice lasts until the page closes */
  }
}
