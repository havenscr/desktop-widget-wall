import { DEFAULT_LIGHT_SYNC, DEFAULT_PALETTE, clampSettings, isPaletteId, type LightSyncSettings, type PaletteId } from '../studio/lightsync/model';

/** Wall 2 settings, read from localStorage. No settings screen yet. */
export const SETTINGS_KEY = 'wall2-settings';

export interface Settings {
  latitude: number;
  longitude: number;
  /** Zen dims by itself from this local hour (18 to 23) until 6 AM, once the wall has been quiet. */
  zenDimHour: number;
  /** Quiet minutes on the wall (1 to 60) before Zen dims by itself. */
  zenDimWaitMin: number;
  /** Names of the task app lists the Shelf place offers (the wall has no route that lists them). */
  shelfLists: string[];
}

export const DEFAULT_SETTINGS: Settings = { latitude: 47.68, longitude: -122.21, zenDimHour: 22, zenDimWaitMin: 10, shelfLists: [] };

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

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The per-PC light sync choice: the palette last picked and the tuning (`wall2.lightsync`). */
export const LIGHT_SYNC_KEY = 'wall2.lightsync';

export interface LightSyncChoice {
  palette: PaletteId;
  settings: LightSyncSettings;
}

/** Saved values, each checked; a missing, odd or unreadable one (a throwing `localStorage` too) takes the default. */
export function loadLightSync(storage: Pick<Storage, 'getItem'> | null = safeStorage()): LightSyncChoice {
  const out: LightSyncChoice = { palette: DEFAULT_PALETTE, settings: { ...DEFAULT_LIGHT_SYNC } };
  try {
    const raw = storage?.getItem(LIGHT_SYNC_KEY);
    if (!raw) return out;
    const saved = JSON.parse(raw) as Record<string, unknown> | null;
    if (saved && typeof saved === 'object') {
      // The custom palette is not pickable yet, so it is never restored.
      if (isPaletteId(saved.palette) && saved.palette !== 'custom') out.palette = saved.palette;
      out.settings = clampSettings(saved.settings);
    }
  } catch {
    /* unreadable: use the defaults */
  }
  return out;
}

export function saveLightSync(choice: LightSyncChoice, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(LIGHT_SYNC_KEY, JSON.stringify(choice));
  } catch {
    /* a full or blocked store: the choice lasts until the page closes */
  }
}
