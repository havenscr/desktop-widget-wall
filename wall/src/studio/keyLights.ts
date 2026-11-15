import { invoke } from '../bridge/tauri';

/**
 * The key light seam. The wall talks to the two desk key lights through one interface, `KeyLightBackend`,
 * so a second back end (the home app passing the sliders through) can be added later without touching the
 * page. Only `direct` exists: the native module that reaches each light on the local network. The page
 * names a side as a word and never holds an address.
 */

export type Side = 'left' | 'right';
/** A write goes to one light or to both. */
export type Target = Side | 'both';

/** The fixed words the native side answers with. */
export const WORDS = ['not-set-up', 'bad-address', 'no-answer', 'timeout', 'failed', 'too-big', 'other-model', 'refused'] as const;
export type Word = (typeof WORDS)[number];

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
    return pairOf(await invoke('wall2_keylights_read'));
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
export async function readStatus(): Promise<{ left: boolean; right: boolean }> {
  const raw = (await invoke('wall2_keylights_status')) as { left?: { set?: unknown }; right?: { set?: unknown } } | null;
  return { left: raw?.left?.set === true, right: raw?.right?.set === true };
}

/**
 * The seam's choice. Today `direct` is the only back end, so this always names it; a `home` back end
 * would be chosen here (only when no address is saved, or when direct has not answered since setup)
 * and would be a second object with the same two methods.
 */
export function chooseBackend(): KeyLightBackend {
  return directBackend;
}
