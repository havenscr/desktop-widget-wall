import { useEffect } from 'react';
import { readCoverTint, setCoverTint } from '../music/coverTint';
import { useNowPlayingStore } from '../music/store';
import { useReducedMotion } from '../ui/useReducedMotion';

/**
 * While Unwind is shown, the dancing lines follow the playing cover's colours (10B, "tint
 * only"): each new cover is read once on a small canvas and the lines cross-fade to it over
 * about 2 seconds (at once with reduced motion). No cover, or one that cannot be read, fades
 * them back to the default teal. Only the visualizer camera tints its lines, so the other
 * places never show these colours.
 */
export function useCoverTintFollow(): void {
  const art = useNowPlayingStore((s) => s.art);
  const reduced = useReducedMotion();
  useEffect(() => {
    let live = true;
    if (!art) {
      setCoverTint(null, performance.now(), reduced);
      return;
    }
    void readCoverTint(art).then((tint) => {
      if (live) setCoverTint(tint, performance.now(), reduced);
    });
    return () => {
      live = false;
    };
  }, [art, reduced]);
}
