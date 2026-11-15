import { useEffect, useRef, type RefObject } from 'react';

/**
 * Runs `measure` again when the element's width changes and once when the page's fonts finish
 * loading, so a fit measured at first paint is corrected after a late font or a resize. The
 * caller still measures in its own layout effect for the first paint; this covers the rest.
 * Nothing is measured while the page is hidden (a locked screen during a cold start) or while the
 * element has no layout box (its screen is not shown): the measurement waits and is made once when
 * the page shows again or the element gets a box. `mounted` changes when the element appears late (a row that renders only with data), so the
 * observer attaches then. The observer is disconnected when the component unmounts.
 */
export function useRemeasure(ref: RefObject<Element | null>, measure: () => void, mounted: unknown = true): void {
  const latest = useRef(measure);
  latest.current = measure;
  useEffect(() => {
    const el = ref.current;
    let live = true;
    // A measurement asked for while hidden or boxless, made when the page shows or the element gets a box.
    let waiting = false;
    const run = () => {
      if (!live) return;
      if (document.hidden || !el || el.getClientRects().length === 0) {
        waiting = true;
        return;
      }
      waiting = false;
      latest.current();
    };
    const onShow = () => {
      if (waiting && !document.hidden) run();
    };
    document.addEventListener('visibilitychange', onShow);
    let ro: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      let width = Number.NaN;
      ro = new ResizeObserver((entries) => {
        const w = entries[entries.length - 1]?.contentRect.width;
        if (w === width) return;
        width = w;
        run();
      });
      ro.observe(el);
    }
    const ready = typeof document !== 'undefined' ? document.fonts?.ready : undefined;
    if (ready) void ready.then(run, () => undefined);
    return () => {
      live = false;
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [ref, mounted]);
}
