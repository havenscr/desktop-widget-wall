import { create } from 'zustand';

export type PlaceId = 'work' | 'home' | 'unwind' | 'zen';
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
  setActive: (id: PlaceId) => void;
}

export const usePlaceStore = create<PlaceState>((set) => ({
  active: 'work',
  setActive: (id) => set({ active: id }),
}));
