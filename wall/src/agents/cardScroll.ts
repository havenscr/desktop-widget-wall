import { create } from 'zustand';

/**
 * A request to bring one card into view in the Work card list (the ribbon's "+N more" row
 * asks for the first hidden session). `n` changes on every request, so asking for the same
 * card twice scrolls twice.
 */
export const useCardScroll = create<{ id: string | null; n: number }>(() => ({ id: null, n: 0 }));

export function scrollToCard(id: string): void {
  useCardScroll.setState((s) => ({ id, n: s.n + 1 }));
}
