import { PINS_CHANGED_EVENT, REF_RE } from './libraryModel';

/** Where the owner's names for Always here keys are kept: a map of key reference to name. */
export const PIN_NAMES_KEY = 'wall2-keys-pin-names';
/** The longest name the field takes; the fit check against the tile is the real limit. */
export const MAX_PIN_NAME = 24;

/**
 * The room a pinned key's label has on the Work row at its narrowest (five tiles: 111 px wide, 95 px inside, drawn at
 * 15 px). The rename fit check holds a name to it as well as to the Unwind tile, so one name fits both rows.
 */
export const WORK_PIN_LABEL_AVAIL = 95;
export const WORK_PIN_LABEL_PX = 15;

export type PinNames = Readonly<Record<string, string>>;

/** Control characters, line and paragraph separators, and zero-width or other format characters (the Cf category). */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
/** A character a person can see (a letter, number, mark, punctuation or symbol). */
const VISIBLE = /[\p{L}\p{N}\p{M}\p{P}\p{S}]/u;

/** The name as it would be stored (trimmed), or null when it is empty, too long, holds a hidden character or has nothing visible. */
export function cleanPinName(name: string): string | null {
  const t = name.trim();
  if (t.length === 0 || t.length > MAX_PIN_NAME || HIDDEN.test(t) || !VISIBLE.test(t)) return null;
  return t;
}

/** The names in a stored text, keeping only an entry whose key is a pin reference and whose name passes `cleanPinName`. */
export function parsePinNames(raw: string | null): PinNames {
  if (raw === null) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [ref, name] of Object.entries(v)) {
    if (!REF_RE.test(ref) || typeof name !== 'string') continue;
    const t = cleanPinName(name);
    if (t !== null) out[ref] = t;
  }
  return out;
}

export function readPinNamesRaw(): string | null {
  try {
    return localStorage.getItem(PIN_NAMES_KEY);
  } catch {
    return null;
  }
}

/** The names as of the last write that storage refused (so they last until the page reloads), else null. */
let unsaved: PinNames | null = null;

export function readPinNames(): PinNames {
  return unsaved ?? parsePinNames(readPinNamesRaw());
}

/** Give `ref` the name `name`, or clear it when the name is empty (a name that fails `cleanPinName` changes nothing). Tells every row showing the keys. */
export function setPinName(ref: string, name: string): void {
  const t = name.trim() === '' ? '' : cleanPinName(name);
  if (t === null) return;
  const next: Record<string, string> = { ...readPinNames() };
  if (t) next[ref] = t;
  else delete next[ref];
  try {
    if (Object.keys(next).length === 0) localStorage.removeItem(PIN_NAMES_KEY);
    else localStorage.setItem(PIN_NAMES_KEY, JSON.stringify(next));
    unsaved = null;
  } catch {
    // Storage may be blocked; the names are then kept in memory and last until the page reloads.
    unsaved = next;
  }
  window.dispatchEvent(new Event(PINS_CHANGED_EVENT));
}

/** For tests: forget names held only in memory. */
export function resetPinNamesMemory(): void {
  unsaved = null;
}
