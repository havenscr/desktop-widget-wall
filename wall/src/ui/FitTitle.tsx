import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useRemeasure } from './useRemeasure';

/** The text sizes a title steps down through, largest first; none goes below 16 px. */
export function fitSizes(top: number): number[] {
  return [top, 52, 44, 38, 32, 26, 22, 20, 18, 16].filter((s, i) => i === 0 || s < top);
}

/**
 * A title that shows in full inside a box of fixed height: it takes the largest size (from `top`
 * down to 16 px) at which its words, wrapped only between words, fit `boxH` px and the box's width.
 * The box never grows, so nothing around it moves. A title that still does not fit at 16 px shows
 * what fits and fades out (`data-cut`: "y" for several lines, a fade downward; "x" for one line or a
 * word wider than the box, a fade over the right edge; the caller puts the whole text in a hover
 * tip); never an ellipsis. Measured again only when the text or the numbers change, when its width
 * changes and when a font finishes loading.
 */
export function FitTitle({
  top,
  boxH,
  lh,
  className,
  children,
  ...rest
}: { top: number; boxH: number; lh: number; className: string; children: ReactNode } & Record<string, unknown>) {
  const ref = useRef<HTMLDivElement>(null);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.removeAttribute('data-cut');
    el.style.maxHeight = '';
    const sizes = fitSizes(top);
    let wide = false;
    for (const size of sizes) {
      el.style.fontSize = `${size}px`;
      const cs = getComputedStyle(el);
      const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      wide = el.scrollWidth > el.clientWidth + 1;
      if (!wide && el.scrollHeight - pad <= boxH + 1) return;
    }
    const last = sizes[sizes.length - 1];
    const rows = Math.floor(boxH / (last * lh) + 0.01);
    if (rows <= 1 || wide) {
      el.setAttribute('data-cut', 'x');
    } else {
      el.style.maxHeight = `${boxH}px`;
      el.setAttribute('data-cut', 'y');
    }
  }, [top, boxH, lh]);
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
    <div ref={ref} className={`${className} fit-fade`} {...rest}>
      {children}
    </div>
  );
}
