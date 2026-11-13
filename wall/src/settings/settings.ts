/** Wall 2 settings, read from localStorage. No settings screen yet. */
export const SETTINGS_KEY = 'wall2-settings';

export interface Settings {
  latitude: number;
  longitude: number;
  /** Zen dims by itself from this local hour (18 to 23) until 6 AM, once the wall has been quiet. */
  zenDimHour: number;
  /** Quiet minutes on the wall (1 to 60) before Zen dims by itself. */
  zenDimWaitMin: number;
}

export const DEFAULT_SETTINGS: Settings = { latitude: 47.68, longitude: -122.21, zenDimHour: 22, zenDimWaitMin: 10 };

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
