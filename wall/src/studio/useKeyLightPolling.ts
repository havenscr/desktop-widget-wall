import { useEffect } from 'react';
import { useAwake } from '../onair/useNow';
import { pollUserChange, READ_EVERY_MS, useKeyLights } from './store';

/**
 * Keeps the key light state fresh while something that shows it is visible: one read when it opens,
 * then every 30 seconds. Nothing is read while the page is hidden or the display is off.
 */
export function useKeyLightPolling(enabled = true): void {
  const awake = useAwake();
  useEffect(() => {
    if (!enabled || !awake) return;
    pollUserChange(1);
    void useKeyLights.getState().refresh();
    const id = setInterval(() => void useKeyLights.getState().refresh(), READ_EVERY_MS);
    return () => {
      clearInterval(id);
      pollUserChange(-1);
    };
  }, [enabled, awake]);
}
