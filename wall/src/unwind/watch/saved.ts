import { defaultLabel, isKind, refKey, validId, type WatchRef } from './links';

/** A saved item: a kind and an id (checked) and the owner's label for it. */
export interface SavedItem extends WatchRef {
  label: string;
  /** True once the owner typed the name (rename); a name fetched from the player never sets it. */
  named?: true;
  /** When it was saved (ms since 1970). */
  addedAt?: number;
  /** When it last played from the list (ms since 1970). */
  lastPlayedAt?: number;
  /** How many times it played from the list. */
  plays?: number;
  /** Its length in seconds, when known (not for a live stream). */
  seconds?: number;
  /** Its view count, when known. */
  views?: number;
  /** The owner's tags, cleaned, at most MAX_TAGS. */
  tags?: string[];
}

/** What a save may know about the video: its length and view count. */
export interface SavedMeta {
  seconds?: number;
  views?: number;
}

export const SAVED_KEY = 'wall2-watch-list';
/** The list's key before saved data v2 (a build older than v2 keeps only 24 of a longer list). */
export const LEGACY_MAX = 24;
export const MAX_SAVED = 200;
/** A copy of the list in the v1 shape (kind, id, label, named), refreshed on every save of a list longer than the old limit. */
export const BACKUP_KEY = 'wall2-watch-list-backup';
/** The stored text exactly as found, copied before a save replaces text that did not read back whole. Slot 1 is this key, slot n the key with "-n". Never overwritten. */
export const RAW_BACKUP_KEY = 'wall2-watch-list-raw';
/** How many distinct originals are kept. */
export const RAW_SLOTS = 4;
/** An old build refuses stored text longer than this and reads an empty list. */
export const OLD_BUILD_MAX = 32_000;
/** Per field caps: a value past one is a bad field and is dropped. */
export const MAX_PLAYS = 1_000_000;
export const MAX_SECONDS = 604_800;
export const MAX_VIEWS = 1_000_000_000_000;
export const MAX_TAGS = 8;
export const MAX_TAG = 24;
export const MAX_LABEL = 60;
/** A stored value longer than this is not read at all. */
const MAX_STORED = 256_000;
/** Saved times must fall between 2020-01-01 and a day from now. */
const MIN_TIME = Date.UTC(2020, 0, 1);
const DAY_MS = 86_400_000;

/** A finite whole number of at least 0, else undefined. */
function wholeCount(v: unknown, max = Number.MAX_SAFE_INTEGER): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0 && v <= max ? v : undefined;
}

/** A time since 2020. `latest` is the newest allowed: no bound on read (a clock set wrong once must not erase stamps), a day past now on write. */
function wholeTime(v: unknown, latest: number): number | undefined {
  const n = wholeCount(v);
  return n !== undefined && n >= MIN_TIME && n <= latest ? n : undefined;
}

/** One tag: cleaned to a line, a leading # dropped, at most 24 characters; empty when nothing is left. */
export function cleanTag(raw: unknown): string {
  return cleanText(typeof raw === 'string' ? raw.replace(/^\s*#+/, '') : raw, MAX_TAG);
}

/** A tag list: each tag cleaned, empty ones dropped, repeats (any case) dropped, at most 8. Undefined when none is left. */
export function cleanTags(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    const tag = cleanTag(t);
    const low = tag.toLowerCase();
    if (!tag || seen.has(low)) continue;
    seen.add(low);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out.length > 0 ? out : undefined;
}

/** The optional fields of a stored entry, each checked on its own: a bad one is left out, never the record. */
function extras(e: Record<string, unknown>, latest: number): Omit<SavedItem, 'kind' | 'id' | 'label' | 'named'> {
  const out: Omit<SavedItem, 'kind' | 'id' | 'label' | 'named'> = {};
  const addedAt = wholeTime(e.addedAt, latest);
  const lastPlayedAt = wholeTime(e.lastPlayedAt, latest);
  const plays = wholeCount(e.plays, MAX_PLAYS);
  const seconds = wholeCount(e.seconds, MAX_SECONDS);
  const views = wholeCount(e.views, MAX_VIEWS);
  const tags = cleanTags(e.tags);
  if (addedAt !== undefined) out.addedAt = addedAt;
  if (lastPlayedAt !== undefined) out.lastPlayedAt = lastPlayedAt;
  if (plays !== undefined) out.plays = plays;
  if (seconds !== undefined) out.seconds = seconds;
  if (views !== undefined) out.views = views;
  if (tags) out.tags = tags;
  return out;
}

/** An item as stored: only the fields it has, in a fixed order, so a v1 list round-trips byte for byte. */
function stored(i: SavedItem): SavedItem {
  const { kind, id, label, named, ...more } = i;
  return { kind, id, label, ...(named ? { named } : {}), ...extras(more as Record<string, unknown>, Date.now() + DAY_MS) };
}

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
 * most 200. Anything else is dropped.
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
    const more = extras(e as Record<string, unknown>, Number.MAX_SAFE_INTEGER);
    if (!isKind(kind) || !validId(kind, id)) continue;
    const ref = { kind, id };
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(named === true ? { ...ref, label: cleanLabel(label, ref), named: true, ...more } : { ...ref, label: cleanLabel(label, ref), ...more });
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

/** True when stored text would not read back whole: too long, not JSON, not a list, or some entries would be dropped (bad ones, repeats, past 200). */
function readsLossy(raw: string): boolean {
  if (raw.length > MAX_STORED) return true;
  try {
    const v: unknown = JSON.parse(raw);
    return !Array.isArray(v) || parseSaved(raw).length !== v.length;
  } catch {
    return true;
  }
}

function rawSlot(n: number): string {
  return n === 1 ? RAW_BACKUP_KEY : `${RAW_BACKUP_KEY}-${n}`;
}

/** Keep `found` in a raw slot: true when a slot already holds exactly it or a free one now does; false when all slots hold other text. */
function keepRaw(found: string): boolean {
  let free = 0;
  for (let n = 1; n <= RAW_SLOTS; n++) {
    const held = localStorage.getItem(rawSlot(n));
    if (held === found) return true;
    if (held === null && free === 0) free = n;
  }
  if (free === 0) return false;
  localStorage.setItem(rawSlot(free), found);
  return true;
}

/** The v1 shape of the list (kind, id, label, named), the first entries that keep the text within what an old build reads. */
export function oldShape(items: readonly SavedItem[]): string {
  const parts: string[] = [];
  let size = 2;
  for (const { kind, id, label, named } of items.slice(0, MAX_SAVED)) {
    const part = JSON.stringify(named ? { kind, id, label, named } : { kind, id, label });
    if (size + part.length + (parts.length > 0 ? 1 : 0) > OLD_BUILD_MAX) break;
    size += part.length + (parts.length > 0 ? 1 : 0);
    parts.push(part);
  }
  return `[${parts.join(',')}]`;
}

/**
 * Write the list. The stored text is never replaced while it holds something this build cannot read back whole
 * unless that text is first kept in a raw slot (up to 4 distinct originals; when none is free, or a copy cannot be
 * written, the list stays for this session and storage is left alone). Then the list is written; a copy in the old
 * shape follows, in its own try, so a full disk costs the copy and never the list. That copy is refreshed only by a save
 * of a list longer than the old limit whose stored text read back whole; every other save leaves it as it is, and the
 * app never removes it (it may hold the only good copy of a long list).
 */
export function saveSaved(items: readonly SavedItem[]): void {
  let clean: boolean;
  try {
    const text = JSON.stringify(items.slice(0, MAX_SAVED).map(stored));
    const found = localStorage.getItem(SAVED_KEY);
    const odd = found !== null && found !== '' && found !== text && readsLossy(found);
    if (odd && !keepRaw(found)) return;
    clean = !odd && !(found !== null && found !== '' && readsLossy(found));
    localStorage.setItem(SAVED_KEY, text);
  } catch {
    /* the list stays for this session */
    return;
  }
  if (!clean || items.length <= LEGACY_MAX) return;
  try {
    localStorage.setItem(BACKUP_KEY, oldShape(items));
  } catch {
    /* no copy this time */
  }
}

export type AddResult = { ok: true; items: SavedItem[]; added: SavedItem } | { ok: false; error: string };

export const ADD_ERRORS = {
  full: `The list is full (${MAX_SAVED}). Remove one first.`,
  dup: 'That one is already in the list.',
} as const;

/** Add an item at the top of the list, unless it is already there or the list is full. */
export function addSaved(items: readonly SavedItem[], ref: WatchRef, meta?: SavedMeta, now?: number): AddResult {
  if (items.some((i) => refKey(i) === refKey(ref))) return { ok: false, error: ADD_ERRORS.dup };
  if (items.length >= MAX_SAVED) return { ok: false, error: ADD_ERRORS.full };
  const added: SavedItem = { kind: ref.kind, id: ref.id, label: defaultLabel(ref) };
  if (now !== undefined) added.addedAt = now;
  const seconds = wholeCount(meta?.seconds, MAX_SECONDS);
  const views = wholeCount(meta?.views, MAX_VIEWS);
  if (seconds) added.seconds = seconds;
  if (views !== undefined) added.views = views;
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

/** What a play changes on a saved item: one more play, the time of it. Items not in the list are left alone. */
export function notePlay(items: readonly SavedItem[], key: string, now: number): SavedItem[] {
  return items.map((i) => (refKey(i) === key ? { ...i, plays: Math.min((i.plays ?? 0) + 1, MAX_PLAYS), lastPlayedAt: now } : i));
}

/** Fill the length and view count an item lacks; what it already has stays. Returns the same array when nothing changes. */
export function noteMeta(items: readonly SavedItem[], key: string, meta: SavedMeta): readonly SavedItem[] {
  const seconds = wholeCount(meta.seconds, MAX_SECONDS);
  const views = wholeCount(meta.views, MAX_VIEWS);
  let changed = false;
  const next = items.map((i) => {
    if (refKey(i) !== key) return i;
    const add: SavedMeta = {};
    if (i.seconds === undefined && seconds) add.seconds = seconds;
    if (i.views === undefined && views !== undefined) add.views = views;
    if (Object.keys(add).length === 0) return i;
    changed = true;
    return { ...i, ...add };
  });
  return changed ? next : items;
}

/** Set an item's tags (cleaned, deduped, at most 8); none left removes the field. */
export function tagSaved(items: readonly SavedItem[], key: string, tags: readonly unknown[]): SavedItem[] {
  const clean = cleanTags(tags);
  return items.map((i) => {
    if (refKey(i) !== key) return i;
    const { tags: _old, ...rest } = i;
    return clean ? { ...rest, tags: clean } : rest;
  });
}
