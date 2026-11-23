/** How long the scrollbar stays up after a list last scrolled (matches the 1 s delay in scrollbar.css). */
export const SCROLL_REVEAL_MS = 1000;

/**
 * Shows the shared scrollbar (ui/scrollbar.css) on whatever list scrolls, however it was moved (wheel, keys, a script):
 * the list carries `data-sb-live` while it scrolls and for SCROLL_REVEAL_MS after. Scroll events do not bubble, so one
 * capture listener on the document serves every list. Returns the function that removes it.
 */
export function installScrollReveal(doc: Document = document, ms: number = SCROLL_REVEAL_MS): () => void {
  const timers = new Map<Element, ReturnType<typeof setTimeout>>();
  const onScroll = (e: Event) => {
    const el = e.target;
    if (!(el instanceof Element)) return;
    el.setAttribute('data-sb-live', '');
    const old = timers.get(el);
    if (old) clearTimeout(old);
    timers.set(
      el,
      setTimeout(() => {
        timers.delete(el);
        el.removeAttribute('data-sb-live');
      }, ms),
    );
  };
  doc.addEventListener('scroll', onScroll, true);
  return () => {
    doc.removeEventListener('scroll', onScroll, true);
    for (const [el, t] of timers) {
      clearTimeout(t);
      el.removeAttribute('data-sb-live');
    }
    timers.clear();
  };
}
