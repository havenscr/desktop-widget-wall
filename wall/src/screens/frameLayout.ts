import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/fitScale';

/**
 * The concept frame's numbers (v3.src.html global CSS), in design pixels. `frame.css`
 * uses the same values and `frameLayout.test.ts` holds the two together, so the layout
 * pull requests for each place can build on these.
 */
export const SHELL_INSET = 20;
export const RAIL_WIDTH = 88;
export const SHELL_GAP = 16;
/** Top band, empty band over the horizon, ribbon. */
export const MAIN_ROWS = [490, 54, 104] as const;
export const MAIN_GAP = 16;
/** Where the main area (and so the clock, its first content) starts on the stage. */
export const MAIN_LEFT = SHELL_INSET + RAIL_WIDTH + SHELL_GAP;
export const MAIN_TOP = SHELL_INSET;
export const MAIN_WIDTH = STAGE_WIDTH - 2 * SHELL_INSET - RAIL_WIDTH - SHELL_GAP;
export const MAIN_HEIGHT = STAGE_HEIGHT - 2 * SHELL_INSET;

/** Top band zones: left wing, centre, right wing. */
export const ZONE_GAP = 30;
export const ZONES = [470, 1290, 596] as const;
/** The in-call Meet view. */
export const ZONES_CALL = [620, 1140, 596] as const;
/** Unwind: the two wings, with the centre taking the rest. */
export const ZONES_WIDE = [470, 540] as const;

/** Left and right edge of each zone, relative to the main area. */
export function zoneEdges(cols: readonly number[]): { left: number; right: number }[] {
  let x = 0;
  return cols.map((w) => {
    const edge = { left: x, right: x + w };
    x += w + ZONE_GAP;
    return edge;
  });
}

/** Stage y of the top and bottom of each main row. */
export function rowEdges(): { top: number; bottom: number }[] {
  let y = MAIN_TOP;
  return MAIN_ROWS.map((h) => {
    const edge = { top: y, bottom: y + h };
    y += h + MAIN_GAP;
    return edge;
  });
}
