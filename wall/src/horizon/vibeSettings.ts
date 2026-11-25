import { create } from 'zustand';

/** What the song title block does under the effects: `scene` keeps it clear, `title` lets them pass over it. */
export type VibeCover = 'scene' | 'title';

export interface VibeSettings {
  /** Colour, glow and the mix follow how loud the music has been lately (on), or sit at fixed levels (off). */
  auto: boolean;
  /** Slices tear across the picture on each drop, with or without Auto vibe. */
  dropGlitch: boolean;
  /** Film grain, scanlines and a slow tracking bar. */
  tapeGrain: boolean;
  /** Halves the strength of every effect and swaps the glitch for a soft swell. */
  calmCap: boolean;
  cover: VibeCover;
}

/** Auto vibe on; the rest off; effects pass over the title. The effects run on Listen and Watch. */
export const DEFAULT_VIBE: Readonly<VibeSettings> = {
  auto: true, dropGlitch: false, tapeGrain: false, calmCap: false, cover: 'title',
};
/** Its own store, so a Lines reset or preset never touches the vibe. */
export const VIBE_KEY = 'wall2-vibe';

const COVERS: VibeCover[] = ['scene', 'title'];
const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

export function validateVibe(value: unknown): VibeSettings {
  const v = value && typeof value === 'object' ? (value as Partial<VibeSettings>) : {};
  return {
    auto: flag(v.auto, DEFAULT_VIBE.auto),
    dropGlitch: flag(v.dropGlitch, DEFAULT_VIBE.dropGlitch),
    tapeGrain: flag(v.tapeGrain, DEFAULT_VIBE.tapeGrain),
    calmCap: flag(v.calmCap, DEFAULT_VIBE.calmCap),
    cover: COVERS.includes(v.cover as VibeCover) ? (v.cover as VibeCover) : DEFAULT_VIBE.cover,
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

/** The settings as the frame reads them, never through a render. */
export const vibeSettings = (): VibeSettings => useVibeStore.getState();

/** Tests: read the stored setting again. */
export function resetVibeStore(): void {
  useVibeStore.setState({ ...load() });
}
