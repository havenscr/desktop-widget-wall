import { useEffect } from 'react';
import { useAwake } from '../onair/useNow';
import { moodsPollChange } from './homeStore';

/**
 * Keeps the office moods fresh while Unwind shows them: one read when it opens, then every 60 seconds
 * (one shared poll). Nothing is read while the page is hidden or the display is off.
 */
export function useMoodsPolling(enabled = true): void {
  const awake = useAwake();
  useEffect(() => {
    if (!enabled || !awake) return;
    moodsPollChange(1);
    return () => moodsPollChange(-1);
  }, [enabled, awake]);
}
