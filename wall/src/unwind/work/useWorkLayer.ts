import { useEffect, useState } from 'react';
import type { PlaceId } from '../../state/places';
import { useHoverHold } from '../../ui/useHoverHold';
import { useWatchRest } from '../watch/rest';
import { useWatchStore } from '../watch/store';
import { useWorkLayerStore } from './layerStore';

/** The pointer shows the layer at once; it hides this long after the pointer and focus leave. */
export const LAYER_CLOSE_MS = 1500;

/** The layer's own overlays, by class: the Day drawer and Agents today (and what sits inside them). They never take the layer down; any other dialog or menu, even one nested in the layer, does. unwind-work.css names the same set. */
const OWN = ':not(.day-drawer):not(.day-drawer *):not(.agents-today):not(.agents-today *)';
/** What keeps the layer down: a take (the video asking to be clicked), a dialog or a menu (the keys row's own and the layer's own overlays are exempt). */
export const SUPPRESS_SELECTOR = `.w-take, [role="dialog"]:not(.u-keys *)${OWN}, [role="menu"]:not(.u-keys *)${OWN}, .u-lib-menu, .watt-menu`;

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
 * The one hover on the Unwind frame: the pointer anywhere on the wall (or focus inside it) shows the Watch controls and the work layer together,
 * and both hide `LAYER_CLOSE_MS` after the pointer and focus leave. The layer stays hidden while the sheet is open (a take, a
 * dialog or a menu do too, so the timeline, the keys and Next up all follow the one `shown` state; the keys row's own menu and picker are exempt and hold it up through `held`).
 * `wall` (in the Watch rest store) is the same hold without the suppression, so the controls stay with the pointer. Spread `handlers` on the frame element, give `setEl` as its ref.
 */
export function useWorkLayer(place: PlaceId) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const sheet = useWatchStore((s) => s.sheet);
  const suppressed = useSuppressed();
  const on = place === 'unwind' && !sheet;
  const { active, handlers } = useHoverHold(el, { openMs: 0, closeMs: LAYER_CLOSE_MS, enabled: on });
  // The keys row's menu, picker or rename popover holds the layer up while it is open (not over the sheet).
  const held = useWorkLayerStore((s) => s.held);
  const panel = useWorkLayerStore((s) => s.panel);
  const shown = on && !suppressed && (active || held || panel);
  useEffect(() => {
    useWatchRest.setState({ wall: active });
    return () => useWatchRest.setState({ wall: false });
  }, [active]);
  useEffect(() => {
    useWorkLayerStore.setState({ shown });
    return () => useWorkLayerStore.setState({ shown: false });
  }, [shown]);
  return { setEl, handlers: place === 'unwind' ? handlers : {} };
}
