import { create } from 'zustand';

/**
 * A counter that moves whenever the brief key is saved or forgotten, from Tools or from the island's Connect. Meet's setup line
 * and the island's brief read it, so each re-reads the key without being remounted. It holds no key and no status.
 */
export const useBriefKeySignal = create<{ n: number }>(() => ({ n: 0 }));

export const briefKeyChanged = () => useBriefKeySignal.setState((s) => ({ n: s.n + 1 }));
