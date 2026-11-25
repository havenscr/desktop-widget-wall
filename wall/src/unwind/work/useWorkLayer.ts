import { useEffect, useState } from 'react';
import type { PlaceId } from '../../state/places';
import { useHoverHold } from '../../ui/useHoverHold';
import { useWatchRest } from '../watch/rest';
import { useWatchStore } from '../watch/store';
import { useWorkLayerStore } from './layerStore';

/** The pointer shows the layer at once; it hides this long after the pointer and focus leave. */
export const LAYER_CLOSE_MS = 1500;

/** What keeps the layer down: a take (the video asking to be clicked), a dialog or a menu. The CSS in unwind-work.css names the same set. */
export const SUPPRESS_SELECTOR = '.w-take, [role="dialog"], [role="menu"], .u-lib-menu, .watt-menu';

/** True while something in SUPPRESS_SELECTOR is on the page. */
export function useSuppressed(): boolean {
  const [on, setOn] = useState(() => document.querySelector(SUPPRESS_SELECTOR) !== null);
  useEffect(() => {
    const look = () => setOn(document.querySelector(SUPPRESS_SELECTOR) !== null);
    // One look per animation frame, however many class changes land in it.
    let frame = 0;
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), look()));
    };
    const watch = new MutationObserver(soon);
    watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'role'] });
    look();
    return () => {
      watch.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return on;
}

/**
 * The work layer's hold on the Unwind frame: the pointer or focus inside the frame shows it, and it hides
 * `LAYER_CLOSE_MS` after both leave. It stays hidden while the Watch controls rest or the sheet is open (a take, a
 * dialog or a menu do too, so the timeline, the keys and Next up all follow the one `shown` state). Spread `handlers` on the frame element, give `setEl` as its ref.
 */
export function useWorkLayer(place: PlaceId) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const rest = useWatchRest((s) => s.rest);
  const sheet = useWatchStore((s) => s.sheet);
  const suppressed = useSuppressed();
  const on = place === 'unwind' && !rest && !sheet && !suppressed;
  const { active, handlers } = useHoverHold(el, { openMs: 0, closeMs: LAYER_CLOSE_MS, enabled: on });
  useEffect(() => {
    useWorkLayerStore.setState({ shown: active });
    return () => useWorkLayerStore.setState({ shown: false });
  }, [active]);
  return { setEl, handlers: place === 'unwind' ? handlers : {} };
}
