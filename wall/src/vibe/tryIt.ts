import { create } from 'zustand';

/** The Try it button: each press counts one. The vibe layer, when one is on screen, fires a hit for each count it has not seen. */
export const useTryStore = create<{ count: number }>(() => ({ count: 0 }));

export function fireTry(): void {
  useTryStore.setState((s) => ({ count: s.count + 1 }));
}
