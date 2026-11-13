import { WALKS } from '../buddy/model';
import { CAMERAS } from '../horizon/cameras';
import { ridgeTopY } from '../horizon/ridge';
import { rowEdges, zoneEdges, ZONES } from '../screens/frameLayout';
import { errorText } from './deckModel';

export interface KeyInfo {
  label: string;
  icon: string;
  /** The wall action name when the key runs one instead of a chord (never a chord). */
  action: string | null;
}
export interface SetInfo {
  id: string;
  name: string;
  /** Accepts any app. */
  general: boolean;
  keys: KeyInfo[];
}
/** What `wall2_keys_summary` answers. No chord and no window title is ever in it. */
export interface KeysSummary {
  /** `app`: a program is remembered; `idle`: nothing yet. */
  front: 'app' | 'idle';
  /** The set Auto shows: the app's own set, else the general one, else null. */
  autoId: string | null;
  /** File name of the program in front, only when it has no set of its own. */
  exe: string | null;
  sets: SetInfo[];
  source: 'file' | 'default';
  /** What "Always here" shows until the owner picks his own: `lib:<id>` or `file:<n>`. */
  defaultPins: string[];
  /** The keys of `pinned` in keys.json, for `file:<n>` pins. */
  filePins: KeyInfo[];
}

/** Auto follows the app in front; Hold keeps one set until Auto is turned on again. */
export interface Mode {
  hold: boolean;
  setId: string | null;
}
export const AUTO: Mode = { hold: false, setId: null };
export const MODE_KEY = 'wall2-keys-mode';
/** The page id of the "For you" page: it is not a set, and keys.json may not use it as one. */
export const FOR_YOU = 'foryou';
const ID_RE = /^[a-z0-9-]{1,24}$/;

/** The mode kept on this display, checked on read: anything odd is Auto. */
export function parseMode(raw: string | null): Mode {
  if (raw === null) return AUTO;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return AUTO;
    const { hold, setId } = v as Record<string, unknown>;
    if (hold === true && typeof setId === 'string' && ID_RE.test(setId)) return { hold: true, setId };
    return AUTO;
  } catch {
    return AUTO;
  }
}

export function readMode(): Mode {
  try {
    return parseMode(localStorage.getItem(MODE_KEY));
  } catch {
    return AUTO;
  }
}

export function saveMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_KEY, JSON.stringify(mode));
  } catch {
    // Storage may be blocked; the mode then lasts until the page reloads.
  }
}

/** A held set that no longer exists in `keys.json` is Auto again. */
export function effectiveMode(mode: Mode, sets: SetInfo[], forYou = false): Mode {
  if (!mode.hold) return AUTO;
  if (mode.setId === FOR_YOU) return forYou ? mode : AUTO;
  return sets.some((s) => s.id === mode.setId) ? mode : AUTO;
}

/** The set the row shows: the held one, else Auto's pick, else none. */
export function shownSet(summary: KeysSummary, mode: Mode): SetInfo | null {
  const m = effectiveMode(mode, summary.sets);
  const id = m.hold ? m.setId : summary.autoId;
  return summary.sets.find((s) => s.id === id) ?? null;
}

/** The set one step along (wrapping), from the one shown; with none shown, the first or last. */
export function stepSet(summary: KeysSummary, from: SetInfo | null, dir: 1 | -1): SetInfo | null {
  const n = summary.sets.length;
  if (n === 0) return null;
  const at = from ? summary.sets.findIndex((s) => s.id === from.id) : -1;
  const next = at < 0 ? (dir === 1 ? 0 : n - 1) : (at + dir + n) % n;
  return summary.sets[next];
}

/** Whether a set's own rule accepts the program in front (the general set accepts any). */
export function acceptsFront(summary: KeysSummary, set: SetInfo): boolean {
  if (summary.front !== 'app') return false;
  return set.general || summary.autoId === set.id;
}

export function headingFor(set: SetInfo): string {
  return set.general ? `Keys: ${set.name}` : `Keys for ${set.name}`;
}

/** The fixed words `wall2_keys_send` answers with, as one short line. */
export function sendReason(e: unknown, set: Pick<SetInfo, 'name' | 'general'>, hold: boolean): string {
  switch (errorText(e)) {
    case 'busy':
      return 'Still sending the last key';
    case 'no key':
      return 'That key is not in keys.json any more';
    case 'no app':
      return hold ? `Wrong app in front for ${set.name}` : `${set.name} is not in front any more`;
    case 'gone':
      return `${set.general ? 'That window' : set.name} is not open any more`;
    case 'elevated':
      return `Cannot type: ${set.general ? 'that app' : set.name} runs as admin`;
    case 'not forward':
      return `Could not bring ${set.general ? 'the app' : set.name} forward`;
    case 'failed':
      return 'The keys were not delivered';
    default:
      return 'Could not send the key';
  }
}

/** One page of the Now row: the "For you" page, or one set of keys. */
export type Page = { id: typeof FOR_YOU; kind: 'foryou' } | { id: string; kind: 'set'; set: SetInfo };

/**
 * The pages in stepping order: "For you" (only while something waits), the set for the app in
 * front, the general set, then every other set.
 */
export function pagesFor(summary: KeysSummary, forYou: boolean): Page[] {
  const pages: Page[] = [];
  if (forYou) pages.push({ id: FOR_YOU, kind: 'foryou' });
  const used = new Set<string>();
  const add = (s: SetInfo | undefined) => {
    if (s && !used.has(s.id)) {
      used.add(s.id);
      pages.push({ id: s.id, kind: 'set', set: s });
    }
  };
  add(summary.sets.find((s) => s.id === summary.autoId && !s.general));
  add(summary.sets.find((s) => s.general));
  summary.sets.forEach(add);
  return pages;
}

/** The page one step along (wrapping), from the one shown; the first or last when none is shown. */
export function stepPage(pages: Page[], fromId: string | null, dir: 1 | -1): Page | null {
  const n = pages.length;
  if (n === 0) return null;
  const at = fromId === null ? -1 : pages.findIndex((p) => p.id === fromId);
  return pages[at < 0 ? (dir === 1 ? 0 : n - 1) : (at + dir + n) % n];
}

/** The page Auto shows: the set for the app in front, else the general set. */
export function autoPage(summary: KeysSummary): Page | null {
  const set = summary.sets.find((s) => s.id === summary.autoId);
  return set ? { id: set.id, kind: 'set', set } : null;
}

/** Keys to a row in both deck rows; every tile is the same size. */
export const KEYS_PER_ROW = 5;
/** A deck tile's height (the Always here and the Now rows alike), design pixels. */
export const DECK_TILE_H = 60;
/** The gap between deck tiles, design pixels. */
export const DECK_TILE_GAP = 8;
/** How far the deck stays above the mountains (and Watt's band), design pixels. */
export const DECK_CLEARANCE = 12;

/**
 * The lowest stage y any part of the deck may reach on Work: a fixed clearance above the
 * highest point of the mountain ridge under the right wing (from the Work camera, as the
 * horizon draws it), and above the band Watt walks in where his walk reaches under the wing.
 */
export function deckFloorY(): number {
  const wing = zoneEdges(ZONES)[2];
  let floor = ridgeTopY(CAMERAS.work, wing.left, wing.right) - DECK_CLEARANCE;
  const walk = WALKS.work;
  if (walk.right > wing.left) floor = Math.min(floor, rowEdges()[0].bottom - DECK_CLEARANCE);
  return Math.floor(floor);
}

/**
 * A key's label on its set's page: the group prefix drops when the page name already says it
 * ("VS Code: command palette" on the VS Code page is "Command palette"). The full name stays in
 * the tooltip, the accessible name and the picker.
 */
export function keyLabel(label: string, pageName: string): string {
  const name = pageName.trim();
  if (!name) return label;
  for (const sep of [': ', ' - ']) {
    const head = `${name}${sep}`;
    if (label.length > head.length && label.slice(0, head.length).toLowerCase() === head.toLowerCase()) {
      const rest = label.slice(head.length).trim();
      if (rest) return rest[0].toUpperCase() + rest.slice(1);
    }
  }
  return label;
}

/** Parts of a set's keys shown at once when a second row does not fit: five at a time. */
export function keyChunks<T>(keys: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < keys.length; i += KEYS_PER_ROW) out.push(keys.slice(i, i + KEYS_PER_ROW));
  return out.length ? out : [[]];
}

/** At most this many page dots; past it the pages show as "8 of 12". */
export const MAX_DOTS = 7;
