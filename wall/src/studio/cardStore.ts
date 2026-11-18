import { create } from 'zustand';

/** Which group's card is open: one at a time. `keys` is the Key lights tile, the rest are the home app's groups. */
export type CardId = 'keys' | 'panels' | 'behindMonitor' | 'overhead';

interface CardState {
  open: CardId | null;
  /** Opened by a key (Enter or Space on the name): focus goes into the card. */
  byKeyboard: boolean;
}

export const useCard = create<CardState>(() => ({ open: null, byKeyboard: false }));

/** The name was activated: open that card, or close it when it is the one already open. */
export function toggleCard(id: CardId, byKeyboard: boolean): void {
  useCard.setState((s) => (s.open === id ? { open: null, byKeyboard: false } : { open: id, byKeyboard }));
}

export const closeCard = (): void => useCard.setState({ open: null, byKeyboard: false });

export const resetCard = closeCard;
