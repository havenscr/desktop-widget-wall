import { useCallback } from 'react';
import { useBrief } from '../../work/useBrief';
import { useLibGroups } from '../../work/keyLibrary';
import { useKeyPress } from '../../work/keyPress';
import { noteResumed, notePaused, useTakes } from '../takes';

/** The press id of the Pause and Resume tile (the Record tile sends the same library key under its own id). */
export const PAUSE_PRESS_ID = 'onair:rec-pause';

/**
 * Everything a row of key tiles needs, from the key deck: the library, the press path (one press is
 * one action) and the result line that shows for a few seconds. The Pause tile learns here that Rust
 * took the press without an error, and only then does the take count as paused or resumed.
 */
export function useDeckKeys() {
  const { groups, failed } = useLibGroups();
  const [brief, showBrief] = useBrief();
  const sent = useCallback((id: string) => {
    if (id !== PAUSE_PRESS_ID) return;
    if (useTakes.getState().takes.current?.pausedAt != null) noteResumed();
    else notePaused();
  }, []);
  const { press, onKeyDown } = useKeyPress(showBrief, () => {}, sent);
  return { groups, failed, brief, showBrief, press, onKeyDown };
}

export type DeckKeys = ReturnType<typeof useDeckKeys>;
