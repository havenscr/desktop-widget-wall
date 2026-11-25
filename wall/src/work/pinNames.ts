import { PINS_CHANGED_EVENT, REF_RE } from './libraryModel';

/** Where the owner's names for Always here keys are kept: a map of key reference to name. */
export const PIN_NAMES_KEY = 'wall2-keys-pin-names';
/** The longest name the field takes; the fit check against the tile is the real limit. */
export const MAX_PIN_NAME = 24;

export type PinNames = Readonly<Record<string, string>>;

/** The names in a stored text, keeping only an entry whose key is a pin reference and whose name is a short non-empty text. */
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
    const t = name.trim();
    if (t.length > 0 && t.length <= MAX_PIN_NAME) out[ref] = t;
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

export function readPinNames(): PinNames {
  return parsePinNames(readPinNamesRaw());
}

/** Give `ref` the name `name`, or clear it when the name is empty. Tells every row showing the keys. */
export function setPinName(ref: string, name: string): void {
  const next: Record<string, string> = { ...readPinNames() };
  const t = name.trim();
  if (t) next[ref] = t.slice(0, MAX_PIN_NAME);
  else delete next[ref];
  try {
    if (Object.keys(next).length === 0) localStorage.removeItem(PIN_NAMES_KEY);
    else localStorage.setItem(PIN_NAMES_KEY, JSON.stringify(next));
  } catch {
    // Storage may be blocked; the name then lasts until the page reloads.
  }
  window.dispatchEvent(new Event(PINS_CHANGED_EVENT));
}
