import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useRemeasure } from './useRemeasure';

/** The text sizes a title steps down through, largest first; none goes below 16 px. */
export function fitSizes(top: number): number[] {
  return [top, 52, 44, 38, 32, 26, 20, 16].filter((s, i) => i === 0 || s < top);
}

/** How many lines a title may take at `size`: `firstLines` at the largest size, `maxLines` below it. */
export function linesAllowed(size: number, top: number, firstLines: number, maxLines = 3): number {
  return size === top ? firstLines : maxLines;
}

/**
 * A title that always shows in full: it takes the largest size (from `top` down to 16 px) at which
 * it fits in its lines, wrapping rather than cutting. `firstLines` lines at `top`, `maxLines` below
 * (the last step, 16 px, is kept even when it still needs more). Measured again only when the text
 * or the numbers change, when its width changes and when a font finishes loading.
 */
export function FitTitle({
  top,
  firstLines,
  maxLines = 3,
  lh,
  className,
  children,
  ...rest
}: { top: number; firstLines: number; maxLines?: number; lh: number; className: string; children: ReactNode } & Record<string, unknown>) {
  const ref = useRef<HTMLDivElement>(null);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    for (const size of fitSizes(top)) {
      el.style.fontSize = `${size}px`;
      const lines = Math.round((el.scrollHeight - pad) / (size * lh));
      if (lines <= linesAllowed(size, top, firstLines, maxLines)) return;
    }
  }, [top, firstLines, maxLines, lh]);
  // Not on every render (a player's progress ticks each second): only when the words or the numbers change.
  useLayoutEffect(measure, [measure, children]);
  // A width change (layout or window resize) or a late font measures again.
  useRemeasure(ref, measure);
  useEffect(() => {
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    if (!fonts?.addEventListener) return;
    fonts.addEventListener('loadingdone', measure);
    return () => fonts.removeEventListener('loadingdone', measure);
  }, [measure]);
  return (
    <div ref={ref} className={className} {...rest}>
      {children}
    </div>
  );
}
