import { dayStart, isoDay } from './days';

/**
 * The last moment this wall saw each session's card working, per session id, for today only.
 * It lets an open run in the day log end where the session stopped (`busy.ts`, `settleOpenRuns`)
 * when the helper does not say, and a reload does not lose it: it is kept in local storage as
 * one small record keyed by day (another day's record is dropped), holding session ids and
 * times only, never titles. Every storage call is inside try and catch (a blocked or full
 * store just means the memory lives until the next reload), and what is read back is checked.
 */
const KEY = 'wall2.workSeen';
/** Most sessions kept; the oldest times go first. */
const MAX_IDS = 200;
const MAX_ID_LEN = 80;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Held {
  day: string;
  seen: Map<string, number>;
}

let mem: Held | null = null;
/** Storage is written at most this often (by the times noted, this PC's clock); the memory is always current. */
const WRITE_EVERY_MS = 30_000;
let dirty = false;
let wroteAt = Number.NEGATIVE_INFINITY;
let listening = false;

/** Write what the memory holds now, if anything changed since the last write. Also runs when the page is left. */
export function flushWorkSeen(): void {
  if (!dirty || !mem) return;
  dirty = false;
  writeStored(mem);
}

/** The stored record for `day`, or an empty one: anything malformed, or from another day, is ignored. */
function readStored(day: string): Held {
  const empty: Held = { day, seen: new Map() };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return empty;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return empty;
    const o = v as { day?: unknown; seen?: unknown };
    if (o.day !== day || typeof o.day !== 'string' || !DAY_RE.test(o.day)) return empty;
    if (typeof o.seen !== 'object' || o.seen === null || Array.isArray(o.seen)) return empty;
    const lo = dayStart(day);
    const hi = lo + 26 * 3_600_000;
    const seen = new Map<string, number>();
    for (const [id, t] of Object.entries(o.seen as Record<string, unknown>)) {
      if (id.length === 0 || id.length > MAX_ID_LEN || typeof t !== 'number' || !Number.isFinite(t) || t < lo || t > hi) continue;
      seen.set(id, t);
      if (seen.size >= MAX_IDS) break;
    }
    return { day, seen };
  } catch {
    return empty;
  }
}

function writeStored(h: Held): void {
  try {
    const newest = [...h.seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_IDS);
    window.localStorage.setItem(KEY, JSON.stringify({ day: h.day, seen: Object.fromEntries(newest) }));
  } catch {
    // No storage: the in-memory copy still serves until the page reloads.
  }
}

function held(day: string): Held {
  if (!mem || mem.day !== day) mem = readStored(day);
  return mem;
}

/** Record that these sessions were working at `at` (this PC's clock). Times only ever move forward. */
export function noteWorking(ids: Iterable<string>, at: number): void {
  if (!Number.isFinite(at)) return;
  const h = held(isoDay(at));
  let changed = false;
  for (const id of ids) {
    if (id.length === 0 || id.length > MAX_ID_LEN) continue;
    if ((h.seen.get(id) ?? -Infinity) < at) {
      h.seen.set(id, at);
      changed = true;
    }
  }
  if (changed) {
    if (h.seen.size > MAX_IDS) {
      const newest = [...h.seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_IDS);
      h.seen = new Map(newest);
    }
    dirty = true;
    if (!listening && typeof window !== 'undefined') {
      listening = true;
      window.addEventListener('pagehide', flushWorkSeen);
    }
    // A poll notes every working session every few seconds: write the record about twice a minute, not each time.
    if (at - wroteAt >= WRITE_EVERY_MS || at < wroteAt) {
      wroteAt = at;
      flushWorkSeen();
    }
  }
}

/** When each session was last seen working on the day of `at`. */
export function seenWorking(at: number): ReadonlyMap<string, number> {
  return held(isoDay(at)).seen;
}

/** A page reload for tests: what waits to be written is written (the page leaving does that), then the memory is forgotten. */
export function resetWorkSeenMemory(): void {
  flushWorkSeen();
  mem = null;
  dirty = false;
  wroteAt = Number.NEGATIVE_INFINITY;
}

/** Forget everything, storage included (tests). */
export function clearWorkSeen(): void {
  mem = null;
  dirty = false;
  wroteAt = Number.NEGATIVE_INFINITY;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
