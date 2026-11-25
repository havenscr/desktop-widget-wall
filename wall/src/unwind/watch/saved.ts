import { defaultLabel, isKind, refKey, validId, type WatchRef } from './links';

/** A saved item: a kind and an id (checked) and the owner's label for it. */
export interface SavedItem extends WatchRef {
  label: string;
  /** True once the owner typed the name (rename); a name fetched from the player never sets it. */
  named?: true;
}

export const SAVED_KEY = 'wall2-watch-list';
export const MAX_SAVED = 24;
export const MAX_LABEL = 60;
/** A stored value longer than this is not read at all. */
const MAX_STORED = 32_000;

/**
 * Text on one line for display: bidi overrides and isolates and zero-width characters dropped,
 * control characters become spaces, spaces folded, trimmed, cut to `max` characters. Empty when
 * nothing is left, or when the input is not a string.
 */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const text = raw.replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, max).join('').trimEnd();
}

/**
 * A label on one line, trimmed, at most 60 characters; the kind's default when empty. Bidi
 * overrides and isolates and zero-width characters are dropped, control characters become spaces.
 */
export function cleanLabel(raw: unknown, ref: WatchRef): string {
  return cleanText(raw, MAX_LABEL) || defaultLabel(ref);
}

/**
 * The saved list from its stored text, checked whole on every read: an array, each entry a
 * known kind with an id of that kind's exact shape, its label cleaned, no item twice, at
 * most 24. Anything else is dropped.
 */
export function parseSaved(raw: string | null): SavedItem[] {
  if (!raw || raw.length > MAX_STORED) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: SavedItem[] = [];
  const seen = new Set<string>();
  for (const e of v) {
    if (out.length >= MAX_SAVED) break;
    if (!e || typeof e !== 'object') continue;
    const { kind, id, label, named } = e as Record<string, unknown>;
    if (!isKind(kind) || !validId(kind, id)) continue;
    const ref = { kind, id };
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(named === true ? { ...ref, label: cleanLabel(label, ref), named: true } : { ...ref, label: cleanLabel(label, ref) });
  }
  return out;
}

export function loadSaved(): SavedItem[] {
  try {
    return parseSaved(localStorage.getItem(SAVED_KEY));
  } catch {
    return [];
  }
}

export function saveSaved(items: readonly SavedItem[]): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(items.slice(0, MAX_SAVED).map(({ kind, id, label, named }) => (named ? { kind, id, label, named } : { kind, id, label }))));
  } catch {
    /* the list stays for this session */
  }
}

export type AddResult = { ok: true; items: SavedItem[]; added: SavedItem } | { ok: false; error: string };

export const ADD_ERRORS = {
  full: `The list is full (${MAX_SAVED}). Remove one first.`,
  dup: 'That one is already in the list.',
} as const;

/** Add an item at the top of the list, unless it is already there or the list is full. */
export function addSaved(items: readonly SavedItem[], ref: WatchRef): AddResult {
  if (items.some((i) => refKey(i) === refKey(ref))) return { ok: false, error: ADD_ERRORS.dup };
  if (items.length >= MAX_SAVED) return { ok: false, error: ADD_ERRORS.full };
  const added = { kind: ref.kind, id: ref.id, label: defaultLabel(ref) };
  return { ok: true, items: [added, ...items], added };
}

export function removeSaved(items: readonly SavedItem[], key: string): SavedItem[] {
  return items.filter((i) => refKey(i) !== key);
}

export function renameSaved(items: readonly SavedItem[], key: string, label: string): SavedItem[] {
  return items.map((i) => {
    if (refKey(i) !== key) return i;
    const clean = cleanLabel(label, i);
    const { named: _was, ...rest } = i;
    const named = clean !== i.label ? clean !== defaultLabel(i) : i.named === true;
    return named ? { ...rest, label: clean, named: true as const } : { ...rest, label: clean };
  });
}
