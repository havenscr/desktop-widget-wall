import { create } from 'zustand';
import { UNDO_SHOW_MS } from './deckModel';

/** The layout the last click applied, shown on the pinned row for a minute with an Undo button. */
export interface AppliedLayout {
  /** The wall action name, `layout:thirds` and so on. */
  action: string;
  text: string;
  until: number;
}

interface DeckState {
  applied: AppliedLayout | null;
  setApplied: (action: string, text: string, now?: number) => void;
  clearApplied: () => void;
}

export const useDeckStore = create<DeckState>((set) => ({
  applied: null,
  setApplied: (action, text, now = Date.now()) => set({ applied: { action, text, until: now + UNDO_SHOW_MS } }),
  clearApplied: () => set({ applied: null }),
}));
