import { useLayoutEffect, useRef, useState } from 'react';

/** The fade out before the head's layout switches, and the fade in after it (ms). The CSS durations match. */
export const HEAD_OUT_MS = 120;
export const HEAD_IN_MS = 130;

/**
 * While the work layer is shown the tall card is shorter, and an opened playlist's head column switches to a compact grid
 * (unwind-work.css). The switch is a hard change of layout, so it hides inside a fade: the head fades out over `HEAD_OUT_MS`,
 * the layout changes while it is clear, then it fades in over `HEAD_IN_MS`, on the way in and on the way out. The layer's state
 * is the frame's `data-work-shown` mark, which the CSS reads too. Returns the ref for the head, whether it is compact, and
 * whether it is fading out. `present` is whether the head is drawn (the effect runs when it appears). A head that mounts while the layer is already up is compact at once, with no fade.
 */
export function useCompactHead<T extends HTMLElement>(present: boolean) {
  const ref = useRef<T | null>(null);
  const [compact, setCompact] = useState(false);
  const [fading, setFading] = useState(false);
  const want = useRef(false);
  useLayoutEffect(() => {
    const main = ref.current?.closest('.main') ?? null;
    if (!main) {
      // No head drawn: nothing is faded or compact, so the next head to mount starts clean.
      setCompact(false);
      setFading(false);
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => main.hasAttribute('data-work-shown');
    want.current = read();
    setCompact(want.current);
    setFading(false);
    const settle = () => {
      timer = null;
      setCompact(want.current);
      setFading(false);
    };
    const watch = new MutationObserver(() => {
      const next = read();
      if (next === want.current) return;
      want.current = next;
      setFading(true);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(settle, HEAD_OUT_MS);
    });
    watch.observe(main, { attributes: true, attributeFilter: ['data-work-shown'] });
    return () => {
      watch.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, [present]);
  return { ref, compact, fading };
}
