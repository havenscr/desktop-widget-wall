// The Comments and Notes split on the Live page: one pure model, no DOM. The two panels share a fixed width (comments + gap + notes
// = 1080), so a move of the handle gives one panel exactly what the other loses.

export const SPLIT_TOTAL = 1080;
export const SPLIT_GAP = 24;
/** The width the two panels share. */
export const SPLIT_PANELS = SPLIT_TOTAL - SPLIT_GAP;
export const RAIL = 72;
export const MIN_COMMENTS = 360;
export const MIN_NOTES = 300;
export const DEFAULT_COMMENTS = 620;
export const DEFAULT_NOTES = SPLIT_PANELS - DEFAULT_COMMENTS;
export const KEY_STEP = 20;
export const SPLIT_STORAGE_KEY = 'wall2-onair-split';

/** A width for the comments panel, `full` (comments fill the space, notes are a rail) or `rail` (comments are a rail, notes fill it). */
export type SplitMode = number | 'full' | 'rail';

export interface SplitWidths {
  comments: number;
  notes: number;
}

/** The comments width kept inside both minimums. Below a minimum a panel does not shrink further. */
export function clampComments(c: number): number {
  if (!Number.isFinite(c)) return DEFAULT_COMMENTS;
  return Math.min(Math.max(Math.round(c), MIN_COMMENTS), SPLIT_PANELS - MIN_NOTES);
}

export function widths(mode: SplitMode): SplitWidths {
  if (mode === 'full') return { comments: SPLIT_PANELS - RAIL, notes: RAIL };
  if (mode === 'rail') return { comments: RAIL, notes: SPLIT_PANELS - RAIL };
  const comments = clampComments(mode);
  return { comments, notes: SPLIT_PANELS - comments };
}

/** The mode after the handle is dragged `dx` px from where it began at `start` px of comments width. */
export function dragTo(start: number, dx: number): number {
  return clampComments(start + dx);
}

/** The mode after an arrow key: left gives the notes 20 px, right gives the comments 20 px. */
export function stepBy(mode: SplitMode, dir: -1 | 1): number {
  return clampComments(widths(mode).comments + dir * KEY_STEP);
}

export const isFolded = (mode: SplitMode): boolean => mode === 'full' || mode === 'rail';

/** What the browser held for this show (any show while `show` is null: YouTube has not answered yet), or null when it holds nothing, another show, or something unreadable. */
export function parseSplit(raw: string | null, show: string | null): SplitMode | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const o = v as { show?: unknown; comments?: unknown };
    if (show !== null && o.show !== show) return null;
    if (o.comments === 'full' || o.comments === 'rail') return o.comments;
    if (typeof o.comments === 'number' && Number.isFinite(o.comments)) return clampComments(o.comments);
  } catch {
    // Unreadable: the default.
  }
  return null;
}

export function serializeSplit(show: string, mode: SplitMode): string {
  return JSON.stringify({ show, comments: mode });
}

/** Development review only: `?split=left|right|comments|notes` shows a fit state without a mouse. */
export function splitOverride(search: string): SplitMode | null {
  const v = new URLSearchParams(search).get('split');
  if (v === 'left') return 400;
  if (v === 'right') return 740;
  if (v === 'comments') return 'full';
  if (v === 'notes') return 'rail';
  return null;
}
