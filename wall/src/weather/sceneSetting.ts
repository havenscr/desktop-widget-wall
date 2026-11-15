import { create } from 'zustand';

/**
 * The Tools switch "Weather in the scene": rain and wind from the forecast on the mountains and on
 * Watt. On by default. Stored as `{"on":true|false}`; anything else that is stored, or nothing,
 * reads as on. The horizon reads it each frame without a render; Watt subscribes.
 */
export const SCENE_WEATHER_KEY = 'wall2-scene-weather';

/** The stored value: only a stored `false` turns it off. */
export function readSceneWeather(raw: string | null): boolean {
  if (raw === null) return true;
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v === 'object' && v !== null && (v as { on?: unknown }).on === false) return false;
  } catch {
    // An unreadable value reads as on.
  }
  return true;
}

function load(): boolean {
  try {
    return readSceneWeather(localStorage.getItem(SCENE_WEATHER_KEY));
  } catch {
    return true;
  }
}

function save(on: boolean): void {
  try {
    localStorage.setItem(SCENE_WEATHER_KEY, JSON.stringify({ on }));
  } catch {
    // Storage may be unavailable: the choice then lasts until the wall restarts.
  }
}

interface SceneWeather {
  on: boolean;
  setOn: (v: boolean) => void;
}

export const useSceneWeather = create<SceneWeather>((set) => ({
  on: load(),
  setOn: (v) => {
    save(v);
    set({ on: v });
  },
}));
