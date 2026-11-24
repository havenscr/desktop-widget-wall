import { useEffect, useState } from 'react';
import type { PlaceId } from '../state/places';
import { skyListed, useBackdropSettings } from './settings';

/** How long the sky layers stay after the sky is wanted no more: the fade's own time (the veil's transition is 600 ms), with a little over. */
export const LINGER_MS = 700;

export interface SkyLayerInput {
  place: PlaceId;
  /** A screen holds the sky (Watch's video behind the land): the front host path runs and the animated sky is not drawn. */
  claimed: boolean;
  reduced: boolean;
  /** Development review knobs: a fixed list of pages in place of the setting. */
  pages?: readonly PlaceId[] | null;
}

/**
 * Whether the animated sky is wanted on the active page, and whether its layers are still mounted.
 * `want` follows the setting, the page, a screen's claim and the graphics context being available.
 * `mounted` is `want` and then 700 ms more, so a fade out finishes before the horizon goes back to
 * one canvas (between frames). Reduced motion has no fade, so it has no wait.
 */
export function useSkyLayer({ place, claimed, reduced, pages }: SkyLayerInput): { want: boolean; mounted: boolean } {
  const places = useBackdropSettings((s) => s.places);
  const available = useBackdropSettings((s) => s.available);
  const want = available && !claimed && skyListed(pages ?? places, place);
  const [prev, setPrev] = useState(want);
  const [lingering, setLingering] = useState(false);
  // Derived from the render before: when the sky stops being wanted, the layers stay a moment.
  if (prev !== want) {
    setPrev(want);
    setLingering(!want && !reduced);
  }
  useEffect(() => {
    if (!lingering) return;
    const timer = window.setTimeout(() => setLingering(false), LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [lingering]);
  return { want, mounted: want || lingering };
}
