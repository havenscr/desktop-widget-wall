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
}

export const usePlaceStore = create<PlaceState>((set) => ({
  active: 'work',
  from: 'work',
  setActive: (id) => set((s) => ({ active: id, from: id === 'zen' && s.active !== 'zen' ? (s.active as CameraPlace) : s.from })),
}));
