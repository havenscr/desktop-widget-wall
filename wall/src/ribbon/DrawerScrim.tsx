import { useEffect, type RefObject, type SyntheticEvent } from 'react';
import { create } from 'zustand';
import { LATCH_MS } from '../work/useGuard';

/**
 * What an open overlay (the Day drawer, the Agents today panel) asks of the rest of the wall: a
 * dim and a slight blur behind it, and nothing behind it alive. The scrim is one stage-wide
 * shield between the page and the overlay. A press on it closes the overlay, and the shield then
 * stays for about a double click (the same latch the keys use), so the rest of that pointer
 * sequence (the second click, the release, a right click's menu) lands on the shield and never on
 * what was under the pointer. The page itself is made `inert` (no hover, no click, no keyboard
 * focus) by `useBehindDrawer`, including anything that mounts while the overlay is open.
 */
type ScrimState = { close: (() => void) | null; guard: boolean };
const useScrimStore = create<ScrimState>(() => ({ close: null, guard: false }));

/** What stays live above the scrim: the hover card the overlay's own controls use. */
const STAYS_LIVE = '.hover-tip, .drawer-scrim';

/** The root attribute the CSS and the window listeners read: set while the shield is up. */
const OPEN_ATTR = 'data-drawer-open';

useScrimStore.subscribe((s) => {
  if (typeof document === 'undefined') return;
  if (s.close || s.guard) document.documentElement.setAttribute(OPEN_ATTR, '');
  else document.documentElement.removeAttribute(OPEN_ATTR);
});

/**
 * True while an overlay owns the pointer (the drawer or panel is open, or its shield is still up
 * after a press closed it). A `window` or `document` listener that reacts to a press, a click or
 * Escape (an outside-click closer, a click noticer) returns early when this is true: `inert`
 * keeps the page's own elements quiet but does not stop those.
 */
export function overlayOwnsPointer(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute(OPEN_ATTR);
}

let guardTimer: ReturnType<typeof setTimeout> | undefined;

/** A press (or a bare click) on the shield: close the overlay and keep the shield up for the rest of the sequence. */
function dismiss() {
  const { close } = useScrimStore.getState();
  if (!close) return;
  clearTimeout(guardTimer);
  useScrimStore.setState({ guard: true });
  guardTimer = setTimeout(() => useScrimStore.setState({ guard: false }), LATCH_MS);
  close();
}

/** Back to the start: no overlay, no shield. For tests. */
export function resetScrim() {
  clearTimeout(guardTimer);
  useScrimStore.setState({ close: null, guard: false });
}

const eat = (e: SyntheticEvent) => {
  e.stopPropagation();
  e.preventDefault();
};

/** The stage-wide layer behind an open overlay. Rendered once, by the app, beside the stage's other layers. */
export function DrawerScrim() {
  const open = useScrimStore((s) => s.close !== null);
  const guard = useScrimStore((s) => s.guard);
  if (!open && !guard) return null;
  // Every event of a pointer sequence is taken here. The press closes (any button); the rest is
  // swallowed. A press must not move keyboard focus out of the overlay, hence the mouse down.
  return (
    <div
      className={open ? 'drawer-scrim' : 'drawer-scrim closing'}
      aria-hidden="true"
      onPointerDown={(e) => {
        e.stopPropagation();
        dismiss();
      }}
      onMouseDown={eat}
      onPointerUp={eat}
      onMouseUp={eat}
      onClick={(e) => {
        eat(e);
        dismiss();
      }}
      onDoubleClick={eat}
      onAuxClick={eat}
      onContextMenu={eat}
    />
  );
}

/**
 * While the overlay is mounted: registers the scrim's close, marks every other part of the app
 * `inert` (each sibling along the overlay's path up to the page, so its own branch stays live; a
 * watcher marks siblings that mount later, such as the leave banner), moves focus into it, and on
 * close undoes it all and returns focus to the Day handle (or, for `'opener'`, to whatever opened
 * it, else the handle).
 */
export function useBehindDrawer(ref: RefObject<HTMLElement | null>, onClose: () => void, back: 'handle' | 'opener' = 'handle') {
  useEffect(() => {
    useScrimStore.setState({ close: onClose });
    return () => useScrimStore.setState((s) => (s.close === onClose ? { close: null } : s));
  }, [onClose]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const held = new Set<Element>();
    const parents: Element[] = [];
    for (let node: Element = el; node.parentElement && node.parentElement !== document.body; node = node.parentElement) parents.push(node.parentElement);
    const hold = () => {
      let node: Element = el;
      for (const parent of parents) {
        for (const sib of parent.children) {
          if (sib === node || held.has(sib) || sib.hasAttribute('inert') || sib.matches(STAYS_LIVE)) continue;
          sib.setAttribute('inert', '');
          held.add(sib);
        }
        node = parent;
      }
    };
    hold();
    const watch = new MutationObserver(hold);
    for (const parent of parents) watch.observe(parent, { childList: true });
    el.focus({ preventScroll: true });
    return () => {
      watch.disconnect();
      for (const h of held) h.removeAttribute('inert');
      const handle = document.querySelector<HTMLElement>('.rib-handle:not(.in-drawer)');
      const to = back === 'opener' && opener && opener.isConnected && opener !== document.body && !el.contains(opener) ? opener : handle;
      to?.focus({ preventScroll: true });
    };
  }, [ref, back]);
}
