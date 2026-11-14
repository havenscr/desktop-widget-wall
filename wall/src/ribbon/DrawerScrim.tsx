import { useEffect, type RefObject } from 'react';
import { create } from 'zustand';

/**
 * What the open Day drawer asks of the rest of the wall: a dim behind it, and nothing behind it
 * alive. The scrim is one stage-wide layer between the page and the drawer;
 * a click on it only closes the drawer, so it never reaches what is under the pointer. The page
 * itself is made `inert` (no hover, no click, no keyboard focus) by `useBehindDrawer`.
 */
type ScrimState = { close: (() => void) | null };
const useScrimStore = create<ScrimState>(() => ({ close: null }));

/** What stays live above the scrim: the hover card the drawer's own controls use. */
const STAYS_LIVE = '.hover-tip, .drawer-scrim';

/** The stage-wide layer behind the open drawer. Rendered once, by the app, beside the stage's other layers. */
export function DrawerScrim() {
  const close = useScrimStore((s) => s.close);
  if (!close) return null;
  // A press on the scrim must not move keyboard focus out of the drawer; the click closes it.
  return <div className="drawer-scrim" aria-hidden="true" onMouseDown={(e) => e.preventDefault()} onClick={close} />;
}

/**
 * While the drawer is mounted: registers the scrim's close, marks every other part of the app
 * `inert` (each sibling along the drawer's path up to the page, so the drawer's own branch stays
 * live), moves focus into the drawer, and on close undoes it all and returns focus to whatever
 * opened it, else the strip's handle.
 */
export function useBehindDrawer(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    useScrimStore.setState({ close: onClose });
    return () => useScrimStore.setState((s) => (s.close === onClose ? { close: null } : s));
  }, [onClose]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const held: Element[] = [];
    for (let node: Element = el; node.parentElement && node.parentElement !== document.body; node = node.parentElement) {
      for (const sib of node.parentElement.children) {
        if (sib === node || sib.hasAttribute('inert') || sib.matches(STAYS_LIVE)) continue;
        sib.setAttribute('inert', '');
        held.push(sib);
      }
    }
    el.focus({ preventScroll: true });
    return () => {
      for (const h of held) h.removeAttribute('inert');
      const back = opener && opener.isConnected && opener !== document.body && !el.contains(opener) ? opener : document.querySelector<HTMLElement>('.rib-handle:not(.in-drawer)');
      back?.focus({ preventScroll: true });
    };
  }, [ref]);
}
