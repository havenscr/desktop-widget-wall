import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { PlaceId } from '../../state/places';
import { useHoverHold } from '../../ui/useHoverHold';
import { useWatchRest } from '../watch/rest';
import { useWatchStore } from '../watch/store';
import { useWorkLayerStore } from './layerStore';

/** The pointer shows the layer at once; it hides this long after the pointer and focus leave. */
export const LAYER_CLOSE_MS = 1500;

/** What keeps the layer down: a take (the video asking to be clicked), a dialog or a menu (the keys row's own are exempt). The CSS in unwind-work.css names the same set. */
export const SUPPRESS_SELECTOR = '.w-take, [role="dialog"]:not(.u-keys *):not(.u-work *), [role="menu"]:not(.u-keys *):not(.u-work *), .u-lib-menu, .watt-menu';

/** The layer answers the pointer only in this bottom band of the frame (design px), or over what the layer owns. */
export const LAYER_BAND_PX = 140;
/** What the pointer may be over, above the band, and still hold the layer: the timeline, its panel and drawer, and the lifted row. */
export const LAYER_OWN = '.u-work, .day-drawer, .agents-today, .u-foot, .u-office-slot';

/** True when a pointer at `y` (client) is in the bottom band of `el`, or `target` is something the layer owns. */
export function inLayerZone(el: HTMLElement, y: number, target: EventTarget | null): boolean {
  const r = el.getBoundingClientRect();
  const scale = el.offsetHeight > 0 && r.height > 0 ? r.height / el.offsetHeight : 1;
  if (y >= r.bottom - LAYER_BAND_PX * scale) return true;
  return target instanceof Element && target.closest(LAYER_OWN) !== null;
}

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
 * The work layer's hold on the Unwind frame: the pointer in the bottom band of the frame (or over the layer's own panel and the lifted row) or focus inside the frame shows it, and it hides
 * `LAYER_CLOSE_MS` after both leave. It stays hidden while the Watch controls rest or the sheet is open (a take, a
 * dialog or a menu do too, so the timeline, the keys and Next up all follow the one `shown` state; the keys row's own menu and picker are exempt and hold it up through `held`). Spread `handlers` on the frame element, give `setEl` as its ref.
 */
export function useWorkLayer(place: PlaceId) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const rest = useWatchRest((s) => s.rest);
  const sheet = useWatchStore((s) => s.sheet);
  const suppressed = useSuppressed();
  const on = place === 'unwind' && !rest && !sheet && !suppressed;
  const { active, handlers } = useHoverHold(el, { openMs: 0, closeMs: LAYER_CLOSE_MS, enabled: on });
  // The keys row's menu, picker or rename popover holds the layer up while it is open (not over the sheet or a rest).
  const held = useWorkLayerStore((s) => s.held);
  const shown = on && (active || held);
  // The pointer holds the layer only while it is in the bottom band or over what the layer owns.
  const inZone = useRef(false);
  const aim = (e: PointerEvent<HTMLElement>) => {
    const now = el ? inLayerZone(el, e.clientY, e.target) : false;
    if (now === inZone.current) return;
    inZone.current = now;
    if (now) handlers.onPointerEnter();
    else handlers.onPointerLeave();
  };
  const away = () => {
    if (!inZone.current) return;
    inZone.current = false;
    handlers.onPointerLeave();
  };
  useEffect(() => {
    useWorkLayerStore.setState({ shown });
    return () => useWorkLayerStore.setState({ shown: false });
  }, [shown]);
  return { setEl, handlers: place === 'unwind' ? { ...handlers, onPointerEnter: aim, onPointerMove: aim, onPointerLeave: away } : {} };
}
