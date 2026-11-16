import { useEffect } from 'react';
import { useAwake } from '../onair/useNow';
import { homePollChange } from './homeStore';

/**
 * Keeps the home half fresh while something that shows it is visible: one read when it opens, then
 * every 60 seconds (one shared poll for every screen that uses this). Nothing is read while the page
 * is hidden or the display is off.
 */
export function useHomePolling(enabled = true): void {
  const awake = useAwake();
  useEffect(() => {
    if (!enabled || !awake) return;
    homePollChange(1);
    return () => homePollChange(-1);
  }, [enabled, awake]);
}
