import { useCallback, useEffect, useState } from 'react';

/** Whether a list is cut off below, and whether it is scrolled to its end (within 4 px). */
export function edgeOf(el: HTMLElement): { over: boolean; end: boolean } {
  const over = el.scrollHeight - el.clientHeight > 1;
  return { over, end: !over || el.scrollHeight - el.scrollTop - el.clientHeight < 4 };
}

/**
 * Drives the `.sb-fade-bottom` mask (ui/scrollbar.css) for a scrolling list: `over` while the list overflows, `end` once it
 * is scrolled to its foot. It re-reads on scroll, whenever `deps` change and whenever the list is resized, so a resize that
 * makes every row fit drops the fade and one that overflows brings it back. Spread `attach` on the list as `ref` and
 * `onScroll`; `className` is the class string to add.
 */
export function useListEdge(deps: readonly unknown[]) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [state, setState] = useState({ over: false, end: false });
  const check = useCallback(() => {
    if (!el) return;
    const next = edgeOf(el);
    setState((s) => (s.over === next.over && s.end === next.end ? s : next));
  }, [el]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(check, [check, ...deps]);
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, check]);
  return {
    ref: setEl,
    onScroll: check,
    className: `sb-fade-bottom${state.over ? ' over' : ''}${state.end ? ' end' : ''}`,
  };
}
