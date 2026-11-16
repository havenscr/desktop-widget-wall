import { invoke } from '../bridge/tauri';
import { homeWordOf, readStudio, setHomeKeys, type HomeKeySide } from './home';

/**
 * The key light seam. The wall talks to the two desk key lights through one interface, `KeyLightBackend`.
 * `direct` is the native module that reaches each light on the local network; `home` is the fallback, the
 * home app passing the key lights through (`keys` in its studio answer). `chooseBackend` says which one a
 * side uses. The page names a side as a word and never holds an address.
 */

export type Side = 'left' | 'right';
/** A write goes to one light or to both. */
export type Target = Side | 'both';

/** The fixed words the native side answers with. */
export const WORDS = ['not-set-up', 'bad-address', 'no-answer', 'timeout', 'failed', 'too-big', 'other-model', 'refused', 'slow-down', 'busy'] as const;
export type Word = (typeof WORDS)[number];

/** Words that say "not now", not "broken": nothing on the block, and the next read corrects it. */
export const isQuiet = (w: unknown): boolean => w === 'slow-down' || w === 'busy';

/** What a light reports: percent 3 to 100, kelvin to the nearest 50. */
export interface Light {
  on: boolean;
  brightness: number;
  kelvin: number;
}

/** One side's answer: the light, or a fixed word. */
export type Reading = Light | Word;
/** Both sides; null for a side a write did not touch. */
export interface Pair {
  left: Reading | null;
  right: Reading | null;
}

/** The fields a write changes. Brightness in percent, warmth in kelvin. */
export interface Patch {
  on?: boolean;
  brightness?: number;
  kelvin?: number;
}

/** The maker's stated range: the light does not report its own, so the page shows these. */
export const BRI_MIN = 3;
export const BRI_MAX = 100;
export const KELVIN_MIN = 2900;
export const KELVIN_MAX = 7000;
export const KELVIN_STEP = 50;

export interface KeyLightBackend {
  /** Both lights, read now. */
  read(): Promise<Pair>;
  /** Writes the patch, then answers with each touched light as it reports after the write. */
  set(target: Target, patch: Patch): Promise<Pair>;
}

export const isLight = (r: Reading | null | undefined): r is Light => typeof r === 'object' && r !== null;

/** Anything the native side sends, checked: a light with sane numbers, a known word, or `failed`. */
export function readingOf(raw: unknown): Reading | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') return (WORDS as readonly string[]).includes(raw) ? (raw as Word) : 'failed';
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.on === 'boolean' && typeof o.brightness === 'number' && typeof o.kelvin === 'number' && Number.isFinite(o.brightness) && Number.isFinite(o.kelvin)) {
      return { on: o.on, brightness: Math.round(o.brightness), kelvin: Math.round(o.kelvin) };
    }
  }
  return 'failed';
}

function pairOf(raw: unknown): Pair {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { left: readingOf(o.left), right: readingOf(o.right) };
}

/** The word in an error from a command (Tauri rejects with the string itself). */
export function wordOf(e: unknown): Word {
  const text = typeof e === 'string' ? e : e instanceof Error ? e.message : '';
  return (WORDS as readonly string[]).includes(text) ? (text as Word) : 'failed';
}

/** The lights reached directly on the local network, through the native commands. */
export const directBackend: KeyLightBackend = {
  async read() {
    const pair = pairOf(await invoke('wall2_keylights_read'));
    noteDirectRead(pair);
    return pair;
  },
  async set(target, patch) {
    const args: Record<string, unknown> = { side: target };
    if (patch.on !== undefined) args.on = patch.on;
    if (patch.brightness !== undefined) args.brightness = Math.round(patch.brightness);
    if (patch.kelvin !== undefined) args.kelvin = Math.round(patch.kelvin);
    return pairOf(await invoke('wall2_keylights_set', args));
  },
};

/** Which saved sides there are: `{ left, right }`, true when an address is saved. Never the address. */
export async function readStatus(): Promise<{ left: boolean; right: boolean; unreadable: boolean }> {
  const raw = (await invoke('wall2_keylights_status')) as { left?: { set?: unknown }; right?: { set?: unknown }; unreadable?: unknown } | null;
  return { left: raw?.left?.set === true, right: raw?.right?.set === true, unreadable: raw?.unreadable === true };
}

// Section: the home back end (6B fallback)

const HOME_WORDS_AS_KEY: Record<string, Word> = { 'no-answer': 'no-answer', 'other-model': 'other-model' };

/** One side of the home app's `keys` as a key light reading. */
function homeReading(side: HomeKeySide): Reading {
  if (side === null) return 'failed';
  if (typeof side === 'string') return HOME_WORDS_AS_KEY[side] ?? 'failed';
  return { on: side.on, brightness: Math.round(side.brightness), kelvin: Math.round(side.kelvin) };
}

/** The key lights as the home app reports them in its studio answer. */
export const homeBackend: KeyLightBackend = {
  async read() {
    const s = await readStudio();
    if (!s.keys || !s.keys.canSet) return { left: 'not-set-up', right: 'not-set-up' };
    return { left: homeReading(s.keys.left), right: homeReading(s.keys.right) };
  },
  async set(target, patch) {
    const args: { on?: boolean; brightness?: number; kelvin?: number } = {};
    if (patch.on !== undefined) args.on = patch.on;
    if (patch.brightness !== undefined) args.brightness = Math.round(patch.brightness);
    if (patch.kelvin !== undefined) args.kelvin = Math.round(patch.kelvin);
    let s;
    try {
      s = await setHomeKeys(target, args);
    } catch (e) {
      // The home app's words that mean "not now" stay quiet; every other one is a plain failure for the page.
      const w = homeWordOf(e);
      throw w === 'busy' ? 'busy' : 'failed';
    }
    const keys = s.keys;
    const out: Pair = { left: null, right: null };
    for (const side of sidesOf(target)) out[side] = keys && keys.canSet ? homeReading(keys[side]) : 'failed';
    return out;
  },
};

const sidesOf = (target: Target): readonly Side[] => (target === 'both' ? ['left', 'right'] : [target]);

// Section: the choice

/** Words from the direct back end that say the light itself is not reachable that way. */
const SILENT_WORDS: readonly unknown[] = ['no-answer', 'timeout', 'other-model'];

/** What the choice depends on. */
export interface BackendInfo {
  /** Which sides have an address saved; null when not known yet. */
  saved: { left: boolean; right: boolean } | null;
  /** Per side: the direct back end has been read at least once, and every read since the app started was one of the silent words. */
  directSilent: Record<Side, boolean>;
  /** The last good studio read has `keys.canSet: true`. */
  homeCanSet: boolean;
}

const directSeen: Record<Side, { reads: number; answered: boolean }> = { left: { reads: 0, answered: false }, right: { reads: 0, answered: false } };
let homeKeysCanSet = false;

/** The home polling calls this after every good studio read. */
export function noteHomeKeys(canSet: boolean): void {
  homeKeysCanSet = canSet;
}

/** Tests only: forget what was seen. */
export function resetSeam(): void {
  directSeen.left = { reads: 0, answered: false };
  directSeen.right = { reads: 0, answered: false };
  homeKeysCanSet = false;
}

/** Records one direct read, so "every read since the app started" can be told. */
function noteDirectRead(pair: Pair): void {
  for (const side of ['left', 'right'] as const) {
    const r = pair[side];
    if (r === null) continue;
    directSeen[side].reads++;
    if (!SILENT_WORDS.includes(r) && r !== 'not-set-up') directSeen[side].answered = true;
  }
}

export function currentInfo(saved: { left: boolean; right: boolean } | null = null): BackendInfo {
  return {
    saved,
    directSilent: {
      left: directSeen.left.reads > 0 && !directSeen.left.answered,
      right: directSeen.right.reads > 0 && !directSeen.right.answered,
    },
    homeCanSet: homeKeysCanSet,
  };
}

/**
 * The choice for one side. `direct` whenever an address is saved for it, unless the direct back end
 * has answered `no-answer`, `timeout` or `other-model` on every read since the app started AND the home
 * app can set the key lights; then `home`. With no address saved and the home app able to set them,
 * `home`. Otherwise `direct` (its own states show).
 */
export function backendNameFor(side: Side, info: BackendInfo): 'direct' | 'home' {
  const saved = info.saved ? info.saved[side] : true;
  if (saved) return info.directSilent[side] && info.homeCanSet ? 'home' : 'direct';
  return info.homeCanSet ? 'home' : 'direct';
}

/** The back end the seam uses now: one of the two, or both split by side. */
export function chooseBackend(info: BackendInfo = currentInfo()): KeyLightBackend {
  const left = backendNameFor('left', info);
  const right = backendNameFor('right', info);
  if (left === 'direct' && right === 'direct') return directBackend;
  if (left === 'home' && right === 'home') return homeBackend;
  const by = (side: Side) => (side === 'left' ? left : right) === 'home' ? homeBackend : directBackend;
  return {
    async read() {
      const [l, r] = await Promise.all([by('left').read(), by('right').read()]);
      return { left: l.left, right: r.right };
    },
    async set(target, patch) {
      const sides = sidesOf(target);
      const results = await Promise.all(sides.map((side) => by(side).set(side, patch)));
      const out: Pair = { left: null, right: null };
      sides.forEach((side, i) => {
        out[side] = results[i][side];
      });
      return out;
    },
  };
}
