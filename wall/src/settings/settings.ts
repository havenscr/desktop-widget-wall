/** Wall 2 settings, read from localStorage. No settings screen yet. */
export const SETTINGS_KEY = 'wall2-settings';

export interface Settings {
  latitude: number;
  longitude: number;
}

export const DEFAULT_SETTINGS: Settings = { latitude: 47.68, longitude: -122.21 };

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
