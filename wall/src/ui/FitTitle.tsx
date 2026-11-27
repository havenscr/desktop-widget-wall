import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useRemeasure } from './useRemeasure';

/** The text sizes a title steps down through, largest first; none goes below 16 px. */
export function fitSizes(top: number): number[] {
  return [top, 52, 44, 38, 32, 26, 20, 16].filter((s, i) => i === 0 || s < top);
}

/** How many lines a title may take at `size`: `firstLines` at the largest size, three below it. */
export function linesAllowed(size: number, top: number, firstLines: number): number {
  return size === top ? firstLines : 3;
}

/**
 * A title that always shows in full: it takes the largest size (from `top` down to 16 px) at which
 * it fits in its lines, wrapping rather than cutting. `firstLines` lines at `top`, three below.
 */
export function FitTitle({ top, firstLines, lh, className, children, ...rest }: { top: number; firstLines: number; lh: number; className: string; children: ReactNode } & Record<string, unknown>) {
  const ref = useRef<HTMLDivElement>(null);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    for (const size of fitSizes(top)) {
      el.style.fontSize = `${size}px`;
      const lines = Math.round(el.scrollHeight / (size * lh));
      if (lines <= linesAllowed(size, top, firstLines)) return;
    }
  }, [top, firstLines, lh]);
  useLayoutEffect(measure);
  useRemeasure(ref, measure);
  return (
    <div ref={ref} className={className} {...rest}>
      {children}
    </div>
  );
}
