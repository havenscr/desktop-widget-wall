import type { HomeWord, Mood, Moods } from './home';
import { OFFICE_OFF, TEXT, type HomeState } from './homeStore';

/**
 * The Office moods row at the foot of Unwind: pure rules (swatches, the fit rule, the one line, the
 * model each chip is drawn from). Nothing here reads a store or the page except `rowModel`'s input.
 */

/** The row's right edge is fixed (wall x 2490); it may reach left to wall x 1240, so at most this wide. */
export const ROW_MAX = 1250;
/** The row's least width: the empty slot's own box, so every older rule keeps its meaning. */
export const ROW_MIN = 420;
/** Space between the row's parts. */
export const ROW_GAP = 8;
/** A chip is 2 px of border, 23 px of padding, the 24 px swatch and its 8 px gap around the name. */
export const CHIP_FIXED = 57;
/** A name is never cut under this much text: a chip of 88 px, the least a click needs (the plan said 33 px of text over a 55 px fixed part that left out the 2 px border). */
export const NAME_MIN = 31;
/** The label pill's margin to the first chip (on top of the gap). */
export const LABEL_MARGIN = 2;
/** The Off chip: 28 px of padding, 2 px of border, and (while its write is out) a 14 px icon and its 8 px gap. */
export const OFF_FIXED = 30;
export const OFF_BUSY_EXTRA = 22;
/** The home app's own caps, mirrored by the native side (`wall2_studio.rs`). */
export const MOOD_MAX = 12;

// Section: swatches

/** The home app sends no colours. These match plain words inside the lower-cased mood id, first row wins. */
const SWATCH_ROWS: readonly (readonly [readonly string[], readonly string[]])[] = [
  [['music', 'party', 'disco'], ['#35e6ea', '#8b5cf6', '#ff4fa3']],
  [['camera', 'video', 'meeting', 'call', 'stream'], ['#ffffff', '#ffe9cf']],
  [['screen', 'comfort', 'soft'], ['#e9e4da', '#bcd0f0']],
  [['focus', 'bright', 'read'], ['#f3f5ff', '#cfe0ff']],
  [['wind', 'down', 'night', 'relax', 'calm', 'evening', 'warm'], ['#ffb975', '#ff8a4d']],
  [['work', 'day'], ['#ffd7a3', '#ff4fa3']],
  [['game', 'gaming', 'play'], ['#8b5cf6', '#35e6ea']],
];
const NEUTRAL = ['#b7afd6', '#5b5480'] as const;

/** The colours of a mood's swatch: three stripes or two halves. */
export function swatchFor(id: string): readonly string[] {
  const lower = id.toLowerCase();
  for (const [words, colours] of SWATCH_ROWS) if (words.some((w) => lower.includes(w))) return colours;
  return NEUTRAL;
}

// Section: the fit rule

export interface Fit {
  /** The label pill shows. */
  label: boolean;
  /** Each name's text is at most this wide (an ellipsis after it); null when none is cut. */
  cap: number | null;
}

/**
 * The row's width limit as a rule on the names. `nameWidths` are the text widths of the mood names, `labelWidth`
 * the whole label pill, `offWidth` the whole Off chip (0 when there is none). 1. As is when it fits 1250.
 * 2. Else the label goes (the group keeps its aria-label). 3. Else every name is cut at the largest shared
 * width that fits (long names shrink first), never under `NAME_MIN` of text.
 */
export function fitMoodRow(nameWidths: readonly number[], labelWidth: number, offWidth: number): Fit {
  const parts = (cap: number, label: boolean): number => {
    const chips = nameWidths.map((w) => CHIP_FIXED + Math.ceil(Math.min(w, cap)));
    const items = [...chips, ...(offWidth > 0 ? [offWidth] : [])];
    const body = items.reduce((a, b) => a + b, 0) + Math.max(0, items.length - 1 + (label ? 1 : 0)) * ROW_GAP;
    return body + (label ? labelWidth + LABEL_MARGIN : 0);
  };
  if (parts(Infinity, true) <= ROW_MAX) return { label: true, cap: null };
  if (parts(Infinity, false) <= ROW_MAX) return { label: false, cap: null };
  const widest = Math.max(NAME_MIN, ...nameWidths.map((w) => Math.ceil(w)));
  for (let cap = widest; cap > NAME_MIN; cap--) if (parts(cap, false) <= ROW_MAX) return { label: false, cap };
  return { label: false, cap: NAME_MIN };
}

// Section: the model

export interface ChipModel {
  /** `null` for the Off chip. */
  id: string | null;
  label: string;
  line: string | null;
  lit: boolean;
  /** This chip's write is out. */
  busy: boolean;
  /** This chip's write was refused or failed, for 5 seconds. */
  failed: boolean;
  swatch: readonly string[] | null;
}

export interface LineModel {
  /** The bold, bright first part ("Label:" or "Label"), or null. */
  lead: string | null;
  rest: string;
  /** Amber: a block, a failure or a sticky word. */
  warn: boolean;
}

export interface RowModel {
  chips: ChipModel[];
  stale: boolean;
  /** This PC may not change the home app: dashed look, clicks send nothing. */
  blocked: boolean;
  /** Some write of the page is out: clicks send nothing until its answer. */
  waiting: boolean;
  line: LineModel;
  /** The amber words of a block or a failure (also the second line of a chip's tip), or null. */
  warnText: string | null;
}

/** The words of a mood write the home app did not take: the same texts as every other home write, plus on air. */
export function moodFailText(word: HomeWord): string {
  switch (word) {
    case 'room-dark':
      return TEXT.roomDark;
    case 'busy':
      return TEXT.busy;
    case 'not-answering':
      return TEXT.notAnswering;
    case 'unreachable':
      return TEXT.unreachable;
    case 'refused':
      return TEXT.refused;
    case 'unknown':
      return TEXT.unknown;
    case 'not-set-up':
      return TEXT.notSetUp;
    case 'needs-private-address':
      return TEXT.needsPrivate;
    case 'nothing-to-undo':
      return TEXT.nothingToUndo;
    case 'on-air':
      return TEXT.onAir;
    case 'home-not-set-up':
      return TEXT.homeNotSetUp;
    case 'forbidden':
      return TEXT.forbidden;
    default:
      return TEXT.failed;
  }
}

/** What the row can show: false until a good read lists a mood. A failed read, an absent or unset home app hides it. */
export function rowShows(s: Pick<HomeState, 'moods' | 'moodsWord'>): boolean {
  return s.moods !== null && s.moodsWord === null && s.moods.moods.length > 0;
}

const NOT_FRESH = ' (not fresh)';

type RowInput = Pick<HomeState, 'moods' | 'moodsWord' | 'applying' | 'moodFail' | 'sticky'>;

/** The one line above the row: sticky, 5 s failure, write block, in flight, mood, Off, nothing. */
export function moodLine(m: Moods, s: Pick<HomeState, 'applying' | 'moodFail' | 'sticky'>): LineModel {
  if (s.sticky === 'home-not-set-up') return { lead: null, rest: TEXT.homeNotSetUp, warn: true };
  if (s.sticky === 'forbidden') return { lead: null, rest: TEXT.forbidden, warn: true };
  if (s.moodFail) return { lead: null, rest: moodFailText(s.moodFail.word), warn: true };
  const block = blockText(m);
  if (block) return { lead: null, rest: block, warn: true };
  const fresh = m.stale ? NOT_FRESH : '';
  if (s.applying !== null) {
    const name = s.applying === OFFICE_OFF ? 'Off' : m.moods.find((x) => x.id === s.applying)?.label;
    if (name) return { lead: `${name}:`, rest: ' asking the home app', warn: false };
  }
  const lit = m.moods.find((x) => x.active);
  if (lit) return lit.line ? { lead: `${lit.label}:`, rest: ` ${lit.line}${fresh}`, warn: false } : { lead: lit.label, rest: ` is on.${fresh}`, warn: false };
  if (m.off?.active) return { lead: null, rest: `Office lights are off.${fresh}`, warn: false };
  return { lead: null, rest: `No mood on.${fresh}`, warn: false };
}

/** Why this PC may not change the home app, in the code's words; null when it may. */
export function blockText(m: Pick<Moods, 'canWrite' | 'writeBlock'>): string | null {
  if (m.canWrite) return null;
  return m.writeBlock === 'needs-private-address' ? TEXT.needsPrivate : TEXT.notSetUp;
}

/** The full text of a line, as one string (the tip, the accessible name). */
export const lineText = (l: LineModel): string => `${l.lead ?? ''}${l.rest}`;

/** What the row is drawn from; null when it shows nothing. */
export function rowModel(s: RowInput): RowModel | null {
  if (!rowShows(s) || !s.moods) return null;
  const m = s.moods;
  const failedId = s.moodFail?.id ?? null;
  const anyLit = m.moods.some((x) => x.active);
  const chips: ChipModel[] = m.moods.map((x: Mood) => ({
    id: x.id,
    label: x.label,
    line: x.line,
    lit: x.active,
    busy: s.applying === x.id,
    failed: failedId === x.id,
    swatch: swatchFor(x.id),
  }));
  if (m.off) {
    chips.push({
      id: null,
      label: 'Off',
      line: null,
      lit: m.off.active && !anyLit,
      busy: s.applying === OFFICE_OFF,
      failed: failedId === OFFICE_OFF,
      swatch: null,
    });
  }
  const block = blockText(m);
  const line = moodLine(m, s);
  return {
    chips,
    stale: m.stale,
    blocked: block !== null,
    waiting: s.applying !== null,
    line,
    warnText: block ?? (s.moodFail ? moodFailText(s.moodFail.word) : null),
  };
}

/** A chip's tip: "<label>: <line>" (the label alone when it has no line), Off its own two sentences, and a second line for a block, a failure or a write in flight. */
export function chipTip(row: RowModel, chip: ChipModel): { first: string; second: string | null; warn: boolean } {
  const first = chip.id === null ? (chip.lit ? 'Office lights are off.' : 'Turns the office lights off. No other room changes.') : chip.line ? `${chip.label}: ${chip.line}` : chip.lit ? `${chip.label} is on.` : chip.label;
  if (row.warnText) return { first, second: row.warnText, warn: true };
  if (row.waiting) return { first, second: 'Asking the home app', warn: false };
  return { first, second: null, warn: false };
}
