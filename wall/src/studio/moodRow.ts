import type { HomeWord, Mood, Moods } from './home';
import { OFFICE_OFF, TEXT, type HomeState } from './homeStore';
import { failText } from './lightsync/model';

/**
 * The Office moods row at the foot of Unwind: pure rules (swatches, the fit rule, the one line, the
 * model each chip is drawn from). Nothing here reads a store or the page except `rowModel`'s input.
 */

/** The row's right edge is fixed (wall x 2364, clear of the Hide screen control); it may reach left to wall x 1240, so at most this wide. */
export const ROW_MAX = 1124;
/** The row's least width: the empty slot's own box, so every older rule keeps its meaning. */
export const ROW_MIN = 420;
/** Space between the row's parts. */
export const ROW_GAP = 8;
/** A chip is 2 px of border, 26 px of padding, the 12 px dot and its 8 px gap around the name. */
export const CHIP_FIXED = 48;
/** A name is never cut under this much text: a chip of 76 px, the least a click needs. It was 88 px while the row had 1250 px; at 1124 twelve chips, Off and the gaps only fit with a floor of 76 (the full name stays in the tip). */
export const NAME_MIN = 28;
/** The label pill's margin to the first chip (on top of the gap). */
export const LABEL_MARGIN = 2;
/** The Off chip: 28 px of padding, 2 px of border, and (while its write is out) a 14 px icon and its 8 px gap. */
export const OFF_FIXED = 30;
/** The icon takes the Off chip's own padding while its write is out (see `.u-mood.off[data-busy]`), so it adds no width. */
export const OFF_BUSY_EXTRA = 0;
/** The As before chip: 2 px of border, 25 px of padding, the 18 px arrow and its 8 px gap (the words are measured). */
export const BACK_FIXED = 53;
export const BACK_WORD = 'As before';
/** Off or As before drawn as the icon alone (the last steps of the fit rule): at least a 40 px click. */
export const ICON_CHIP = 40;
/** The Music sync chip, first in the row, a fixed width: 2 px of border, 14 px of padding each side, the 18 px pulse icon and its 8 px gap, the name (92.5 px in the chip font), a 12 px gap and the 40 px switch: 200.5 px, drawn as 203 for font slack. */
export const SYNC_WIDTH = 203;
export const SYNC_WORD = 'Music sync';
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

/** The colours of a mood's dot: one, or a blend of the first two. */
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
  /** As before is the arrow alone (names are already at the floor). */
  backIcon: boolean;
  /** Off is the icon alone (As before already is). */
  offIcon: boolean;
  /** Even then the row is wider than its box: the slot clips at its left edge instead of spilling over its neighbours. */
  clip: boolean;
}

/**
 * The row's width limit as a rule on the names. `nameWidths` are the text widths of the mood names, `labelWidth`
 * the whole label pill, `offWidth` the whole Off chip (0 when there is none), `backWidth` the whole As before chip (0 when not drawn).
 * 1. As is when it fits 1124. 2. Else the label goes (the group keeps its aria-label). 3. Else every name is cut at
 * the largest shared width that fits (long names shrink first), never under `NAME_MIN` of text. 4. Else As before
 * becomes its arrow alone (`ICON_CHIP` wide). 5. Else Off does too. 6. Else the slot clips its left edge. Mood chips never go under 76 px.
 * `syncWidth` is the Music sync chip's fixed width (`SYNC_WIDTH`, 0 when it is not drawn); it never shrinks.
 */
export function fitMoodRow(nameWidths: readonly number[], labelWidth: number, offWidth: number, backWidth = 0, syncWidth = 0): Fit {
  const parts = (cap: number, label: boolean, off: number, back: number): number => {
    const chips = nameWidths.map((w) => CHIP_FIXED + Math.ceil(Math.min(w, cap)));
    const items = [...(syncWidth > 0 ? [syncWidth] : []), ...chips, ...(off > 0 ? [off] : []), ...(back > 0 ? [back] : [])];
    const body = items.reduce((a, b) => a + b, 0) + Math.max(0, items.length - 1 + (label ? 1 : 0)) * ROW_GAP;
    return body + (label ? labelWidth + LABEL_MARGIN : 0);
  };
  const base = { backIcon: false, offIcon: false, clip: false };
  if (parts(Infinity, true, offWidth, backWidth) <= ROW_MAX) return { label: true, cap: null, ...base };
  if (parts(Infinity, false, offWidth, backWidth) <= ROW_MAX) return { label: false, cap: null, ...base };
  const widest = Math.max(NAME_MIN, ...nameWidths.map((w) => Math.ceil(w)));
  for (let cap = widest; cap > NAME_MIN; cap--) if (parts(cap, false, offWidth, backWidth) <= ROW_MAX) return { label: false, cap, ...base };
  const floor = { label: false, cap: NAME_MIN };
  if (parts(NAME_MIN, false, offWidth, backWidth) <= ROW_MAX) return { ...floor, ...base };
  const backOnly = backWidth > 0 ? ICON_CHIP : 0;
  if (parts(NAME_MIN, false, offWidth, backOnly) <= ROW_MAX) return { ...floor, ...base, backIcon: backWidth > 0 };
  const offOnly = offWidth > 0 ? ICON_CHIP : 0;
  const fits = parts(NAME_MIN, false, offOnly, backOnly) <= ROW_MAX;
  return { ...floor, backIcon: backWidth > 0, offIcon: offWidth > 0, clip: !fits };
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
  /** A mood is on: the As before chip is live. */
  canBack: boolean;
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
    case 'no-mood':
      return TEXT.noMood;
    case 'at-floor':
      return TEXT.atFloor;
    case 'at-max':
      return TEXT.atMax;
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
    canBack: anyLit,
    blocked: block !== null,
    waiting: s.applying !== null,
    line,
    warnText: block ?? (s.moodFail ? moodFailText(s.moodFail.word) : null),
  };
}

/** A chip's tip: "<label>: <line>" (the label alone when it has no line), Off its own two sentences, and a second line for a block, a failure or a write in flight. */
/** The As before chip's tip: the home app's own words for the call, or why it does nothing. */
export function backTip(row: RowModel, iconOnly = false): { first: string; second: string | null; warn: boolean } {
  const t = backTipFull(row);
  // Drawn as the arrow alone, the tip names the chip first and keeps the home words under it.
  return iconOnly ? { first: BACK_WORD, second: t.second ?? t.first, warn: t.second !== null && t.warn } : t;
}

function backTipFull(row: RowModel): { first: string; second: string | null; warn: boolean } {
  if (!row.canBack) return { first: 'Nothing to go back from', second: row.warnText, warn: row.warnText !== null };
  const first = 'Puts the office back the way it was before the mood';
  if (row.warnText) return { first, second: row.warnText, warn: true };
  if (row.waiting) return { first, second: 'Asking the home app', warn: false };
  return { first, second: null, warn: false };
}

export function chipTip(row: RowModel, chip: ChipModel): { first: string; second: string | null; warn: boolean } {
  const first = chip.id === null ? (chip.lit ? 'Office lights are off.' : 'Turns the office lights off. No other room changes.') : chip.line ? `${chip.label}: ${chip.line}` : chip.lit ? `${chip.label} is on.` : chip.label;
  if (row.warnText) return { first, second: row.warnText, warn: true };
  if (row.waiting) return { first, second: 'Asking the home app', warn: false };
  return { first, second: null, warn: false };
}

// Section: the Music sync chip

export interface SyncChipInput {
  starting: boolean;
  running: boolean;
  failure: string | null;
  paletteName: string;
  /** The tip says "Stopped Hue Sync" (true only the one time). */
  hueNote: boolean;
}

export interface SyncChipModel {
  lit: boolean;
  busy: boolean;
  failed: boolean;
}

export function syncChipModel(i: SyncChipInput): SyncChipModel {
  return { lit: i.running && !i.starting, busy: i.starting, failed: i.failure !== null && !i.starting };
}

/** The chip's tip: what a click does now, then (second line) a failure or the one-time Hue Sync note. */
export function syncTip(i: SyncChipInput): { first: string; second: string | null; warn: boolean } {
  if (i.starting) return { first: 'Starting music sync', second: null, warn: false };
  if (i.failure !== null) return { first: 'Music sync: click to try again', second: failText(i.failure), warn: true };
  if (i.running) return { first: `Music sync is on in ${i.paletteName}. Click to stop it and put the lights back.`, second: i.hueNote ? 'Stopped Hue Sync' : null, warn: false };
  return { first: `Starts the lights dancing to the music in ${i.paletteName}.`, second: null, warn: false };
}
