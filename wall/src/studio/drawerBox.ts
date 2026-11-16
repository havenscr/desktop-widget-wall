import { stageBox } from '../horizon/sky';

/** Where the sheet sat before it followed a column: used when its opener is in no column. */
export const DRAWER_FALLBACK = { left: 1680, width: 860 } as const;
/** The sheet is never narrower than this, in canvas pixels. */
export const DRAWER_MIN_WIDTH = 560;
/** The columns a sheet may overlay: the right column of On Air. */
const COLUMN = '.oa-right';

/** The column that holds the control that opened the sheet, or null when it sits in none. */
export function openerColumn(): Element | null {
  const opener = document.querySelector('[data-st-opener]');
  return opener?.closest(COLUMN) ?? null;
}

/**
 * The sheet's left edge and width in canvas pixels: the opener's column box (read in the stage's
 * design pixels), widened to the left only as far as the minimum needs; the old fixed place when
 * the opener sits in no column or the column has no measurable box.
 */
export function drawerBox(column: Element | null = openerColumn()): { left: number; width: number } {
  const b = column ? stageBox(column) : null;
  if (!b) return { ...DRAWER_FALLBACK };
  const [x, , w] = b;
  const width = Math.max(DRAWER_MIN_WIDTH, w);
  return { left: x + w - width, width };
}
