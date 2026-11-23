/** How long a list keeps its bar after it last scrolled, before the CSS hold (0.9 s) and fade (0.3 s); the two holds make 1 s. */
export const SCROLL_REVEAL_MS = 100;

/** The innermost element at or above `from` that really scrolls (overflows and allows it), or null. */
export function scrollerAt(from: Element | null, doc: Document): Element | null {
  const view = doc.defaultView;
  for (let el = from; el; el = el.parentElement) {
    if (el === doc.body || el === doc.documentElement) return el === doc.body ? doc.documentElement : el;
    if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) continue;
    const st = view?.getComputedStyle(el);
    if (st && /(auto|scroll)/.test(st.overflowY + st.overflowX)) return el;
  }
  return null;
}

/**
 * Shows the shared scrollbar (ui/scrollbar.css) on whatever list scrolls, however it was moved (wheel, keys, a script):
 * the list carries `data-sb-live` while it scrolls and for SCROLL_REVEAL_MS after, and `data-sb-hover` while the pointer
 * is over it (the innermost scrolling list only, so an outer list's bar stays hidden). Scroll events do not bubble, so one
 * capture listener on the document serves every list. Returns the function that removes both.
 */
export function installScrollReveal(doc: Document = document, ms: number = SCROLL_REVEAL_MS): () => void {
  const timers = new Map<Element, ReturnType<typeof setTimeout>>();
  let hovered: Element | null = null;
  const onScroll = (e: Event) => {
    const el = e.target instanceof Document ? e.target.documentElement : e.target;
    if (!(el instanceof Element)) return;
    if (!el.hasAttribute('data-sb-live')) el.setAttribute('data-sb-live', '');
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
  const mark = (el: Element | null) => {
    if (el === hovered) return;
    hovered?.removeAttribute('data-sb-hover');
    hovered = el;
    el?.setAttribute('data-sb-hover', '');
  };
  const onOver = (e: Event) => mark(e.target instanceof Element ? scrollerAt(e.target, doc) : null);
  const onLeave = (e: Event) => {
    if ((e as MouseEvent).relatedTarget === null) mark(null);
  };
  doc.addEventListener('scroll', onScroll, true);
  doc.addEventListener('pointerover', onOver, true);
  doc.addEventListener('pointerout', onLeave, true);
  return () => {
    doc.removeEventListener('scroll', onScroll, true);
    doc.removeEventListener('pointerover', onOver, true);
    doc.removeEventListener('pointerout', onLeave, true);
    for (const [el, t] of timers) {
      clearTimeout(t);
      el.removeAttribute('data-sb-live');
    }
    timers.clear();
    mark(null);
  };
}
