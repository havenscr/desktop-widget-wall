import { errorText } from './deckModel';

export interface KeyInfo {
  label: string;
  icon: string;
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
}

/** Auto follows the app in front; Hold keeps one set until Auto is turned on again. */
export interface Mode {
  hold: boolean;
  setId: string | null;
}
export const AUTO: Mode = { hold: false, setId: null };
export const MODE_KEY = 'wall2-keys-mode';
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
export function effectiveMode(mode: Mode, sets: SetInfo[]): Mode {
  return mode.hold && sets.some((s) => s.id === mode.setId) ? mode : AUTO;
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
export function sendReason(e: unknown, set: SetInfo, hold: boolean): string {
  switch (errorText(e)) {
    case 'busy':
      return 'Still sending the last key';
    case 'no key':
      return 'That key is not in keys.json any more';
    case 'no app':
      return hold ? `The app in front is not ${set.name}` : `${set.name} is not the app in front any more`;
    case 'gone':
      return `${set.general ? 'That window' : set.name} is not open any more`;
    case 'elevated':
      return `${set.general ? 'That app' : set.name} runs as administrator, so the wall cannot type into it`;
    case 'not forward':
      return `Could not bring ${set.general ? 'the app' : set.name} forward`;
    case 'failed':
      return 'The keys were not delivered';
    default:
      return 'Could not send the key';
  }
}
