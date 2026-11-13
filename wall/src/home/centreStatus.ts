import { create } from 'zustand';

/**
 * What each centre source can show: `ok` (cards on screen, live or dimmed), `loading`,
 * `unconfigured` (its key is missing from feeds.json) or `down` (never reached this
 * session, nothing to show). Moods and Sound publish theirs; when both are out the centre
 * shows one status card instead of two fragments.
 */
export type SourceState = 'ok' | 'loading' | 'unconfigured' | 'down';

interface Source {
  state: SourceState;
  /** When its last good read arrived (epoch ms), if one did. */
  okAt: number | null;
  /** Reads it again now. */
  check: (() => void) | null;
}

interface CentreState {
  moods: Source;
  sonos: Source;
  set: (which: 'moods' | 'sonos', s: Source) => void;
}

const EMPTY: Source = { state: 'loading', okAt: null, check: null };

export const useCentreStatus = create<CentreState>((set) => ({
  moods: EMPTY,
  sonos: EMPTY,
  set: (which, s) => set({ [which]: s } as Pick<CentreState, typeof which>),
}));

/** Both sources out (not set up or never reached): the one status card shows. */
export function bothOut(a: SourceState, b: SourceState): boolean {
  const out = (x: SourceState) => x === 'unconfigured' || x === 'down';
  return out(a) && out(b);
}
