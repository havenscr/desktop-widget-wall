import type { KeyInfo } from './keysModel';

/** One key of the built-in library as `wall2_keys_library` answers (never a chord). */
export interface LibKey {
  id: string;
  label: string;
  icon: string;
  /** `key` a key press, `wall` something the wall does, `check` a shortcut to confirm on the PC, `soon` not yet. */
  kind: 'key' | 'wall' | 'check' | 'soon';
  how: string;
  action: string | null;
  runnable: boolean;
}
export interface LibGroup {
  id: string;
  title: string;
  /** The programs the group's keys go to; empty means any program. */
  exes: string[];
  keys: LibKey[];
}

export const PINS_KEY = 'wall2-keys-pins';
export const PINS_CHANGED_EVENT = 'wall2-pins-changed';
/** "Always here" holds at most this many keys. */
export const MAX_PINS = 5;
/**
 * The pins shown when the helper cannot answer (keys.json invalid) and the owner has picked none.
 * They equal Rust's `DEFAULT_PINS` (a test reads that file).
 */
export const FALLBACK_PINS: readonly string[] = ['lib:thirds', 'lib:focus', 'lib:record-169', 'lib:snip', 'lib:strip-dark'];

const REF_RE = /^(lib:[a-z0-9-]{1,24}|file:[0-9]{1,2})$/;

/** A pin ready to draw and send. */
export interface PinView {
  /** `lib:<id>` or `file:<n>`. */
  ref: string;
  label: string;
  icon: string;
  action: string | null;
  /** A chord key goes to the program in front (and only to the programs of its group). */
  kind: LibKey['kind'] | 'file';
  how: string;
  /** The group the key belongs to, for the tooltip of a key like "Mute" that several groups have. */
  group: string | null;
  runnable: boolean;
}

export function allKeys(lib: readonly LibGroup[]): Map<string, { key: LibKey; group: LibGroup }> {
  const m = new Map<string, { key: LibKey; group: LibGroup }>();
  for (const g of lib) for (const k of g.keys) m.set(k.id, { key: k, group: g });
  return m;
}

/** A pin reference as something drawable, or null when it names nothing that exists and can run. */
export function resolvePin(ref: string, lib: readonly LibGroup[], filePins: readonly KeyInfo[]): PinView | null {
  if (!REF_RE.test(ref)) return null;
  if (ref.startsWith('file:')) {
    const k = filePins[Number(ref.slice(5))];
    return k ? { ref, label: k.label, icon: k.icon, action: k.action, kind: 'file', how: 'From keys.json', group: null, runnable: true } : null;
  }
  const hit = allKeys(lib).get(ref.slice(4));
  if (!hit || !hit.key.runnable || hit.key.kind === 'soon') return null;
  const { key, group } = hit;
  return { ref, label: key.label, icon: key.icon, action: key.action, kind: key.kind, how: key.how, group: group.exes.length > 0 ? group.title : null, runnable: true };
}

/**
 * The pins kept on this display, checked on read against the library and keys.json: anything
 * odd (not a list, too long, an unknown id, a key that cannot run, a repeat) gives null and
 * the defaults apply. Nothing in storage is ever sent as it is.
 */
export function parsePins(raw: string | null, lib: readonly LibGroup[], filePins: readonly KeyInfo[]): string[] | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v) || v.length > MAX_PINS) return null;
    const out: string[] = [];
    for (const r of v) {
      if (isFileEntry(r)) {
        // A pin on a keys.json key is an index, so it carries the key's label and action and is
        // dropped when the file no longer has that same key at that place.
        const k = filePins[Number(r.ref.slice(5))];
        if (k && k.label === r.label && k.action === r.action && !out.includes(r.ref)) out.push(r.ref);
        continue;
      }
      // A bare file index (no label to check it by) is dropped like a changed one.
      if (typeof r === 'string' && r.startsWith('file:')) continue;
      if (typeof r !== 'string' || out.includes(r) || !resolvePin(r, lib, filePins)) return null;
      out.push(r);
    }
    return v.length === 0 ? [] : out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

interface FileEntry {
  ref: string;
  label: string;
  action: string | null;
}

function isFileEntry(v: unknown): v is FileEntry {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o.ref === 'string' && /^file:[0-9]{1,2}$/.test(o.ref) && typeof o.label === 'string' && (o.action === null || typeof o.action === 'string');
}

/** The text kept in storage for these pins: library ids as they are, keys.json keys with their label and action. */
export function serializePins(refs: readonly string[], filePins: readonly KeyInfo[]): string {
  return JSON.stringify(
    refs.map((r) => {
      if (!r.startsWith('file:')) return r;
      const k = filePins[Number(r.slice(5))];
      return { ref: r, label: k?.label ?? '', action: k?.action ?? null };
    }),
  );
}

export function readPinsRaw(): string | null {
  try {
    return localStorage.getItem(PINS_KEY);
  } catch {
    return null;
  }
}

export function savePins(pins: readonly string[] | null): void {
  try {
    if (pins === null) localStorage.removeItem(PINS_KEY);
    else localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  } catch {
    // Storage may be blocked; the pins then last until the page reloads.
  }
}

/** Put `ref` in slot `slot`; when it is already in another slot the two swap. */
export function swapPin(pins: readonly string[], slot: number, ref: string): string[] {
  const out = [...pins];
  const at = out.indexOf(ref);
  if (slot >= out.length) {
    if (at < 0 && out.length < MAX_PINS) out.push(ref);
    return out;
  }
  if (at >= 0 && at !== slot) out[at] = out[slot];
  out[slot] = ref;
  return out;
}

/** Remove one pin without changing the order of the others. The last pin may be removed. */
export function removePin(pins: readonly string[], slot: number): string[] {
  return pins.filter((_ref, index) => index !== slot);
}

/** Library groups narrowed by a search, matching label, group title and what the key does. Empty groups drop out. */
export function searchLibrary(lib: readonly LibGroup[], query: string): LibGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...lib];
  return lib
    .map((g) => ({ ...g, keys: g.keys.filter((k) => `${k.label} ${g.title} ${k.how}`.toLowerCase().includes(q)) }))
    .filter((g) => g.keys.length > 0);
}
