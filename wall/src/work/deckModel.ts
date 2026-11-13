/** Shared by the Big screen and Keys rows: brief results, and telling "not here" from "a problem". */

/** How long a result stays on a row. */
export const BRIEF_MS = 6_000;
/** How long the Undo button shows after a layout (the Rust side accepts it a little longer). */
export const UNDO_SHOW_MS = 60_000;

/** The text of a rejected command, whatever shape it arrives in. */
export function errorText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  return '';
}

/**
 * True when the commands do not exist here (a non-Windows build, an older app, a plain
 * browser with no mock): the row is then not drawn at all.
 */
export function isAbsent(e: unknown): boolean {
  const t = errorText(e);
  return t === 'unsupported' || t === 'forbidden' || /not found|No mock registered|not allowed/i.test(t);
}

export const windowsText = (n: number, verb: string): string => `${n} window${n === 1 ? '' : 's'} ${verb}`;

/** What `wall2_arrange` answers: windows asked, and windows whose frame reached its place. */
export interface ArrangeResult {
  moved: number;
  asked: number;
}

/** "3 windows arranged", or "2 of 3 windows arranged" when one refused or stopped short. */
export function arrangedText(r: ArrangeResult): string {
  const moved = Number.isFinite(r.moved) ? r.moved : 0;
  const asked = Number.isFinite(r.asked) ? r.asked : moved;
  return moved >= asked ? windowsText(moved, 'arranged') : `${moved} of ${asked} windows arranged`;
}

/** The fixed words `wall2_arrange` and `wall2_arrange_undo` answer with, as one short line each. */
export function arrangeReason(word: string): string {
  if (/^(zoneApps rule|zone) \d+:/.test(word)) return word;
  switch (word) {
    case 'no big screen':
      return 'No big screen found';
    case 'no windows':
      return 'No windows to arrange on the big screen';
    case 'nothing to undo':
      return 'Nothing to undo';
    case 'none moved':
      return 'No window could be moved';
    case 'busy':
      return 'Still arranging, try again in a moment';
    default:
      return 'Could not arrange the windows';
  }
}
