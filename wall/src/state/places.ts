import { create } from 'zustand';

export type PlaceId = 'work' | 'home' | 'unwind' | 'meet' | 'zen';
/** The places with a horizon camera (Zen draws no horizon). */
export type CameraPlace = Exclude<PlaceId, 'zen'>;

/** The places in the main group of the rail; Zen has its own button lower down. */
export const PLACES: readonly { id: PlaceId; label: string }[] = [
  { id: 'work', label: 'Work' },
  { id: 'home', label: 'Home' },
  { id: 'unwind', label: 'Unwind' },
];

interface PlaceState {
  active: PlaceId;
  /** The place Zen was opened from (Work until then); Leave goes back there. */
  from: CameraPlace;
  setActive: (id: PlaceId) => void;
  /** Set by `openDream`; Zen reads it once when it opens and starts in Dream. */
  zenDream: boolean;
  /** Open Zen straight into Dream (Unwind's Dream tab). */
  openDream: () => void;
  /** Zen calls this once it has read `zenDream`. */
  takeZenDream: () => boolean;
}

export const usePlaceStore = create<PlaceState>((set, get) => ({
  active: 'work',
  from: 'work',
  zenDream: false,
  setActive: (id) => set((s) => ({ active: id, from: id === 'zen' && s.active !== 'zen' ? (s.active as CameraPlace) : s.from })),
  openDream: () => {
    set({ zenDream: true });
    get().setActive('zen');
  },
  takeZenDream: () => {
    const was = get().zenDream;
    if (was) set({ zenDream: false });
    return was;
  },
}));
