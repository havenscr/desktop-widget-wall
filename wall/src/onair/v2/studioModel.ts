/** The studio keys, in the order of the row. Rust knows the same five names. */
export type StudioKey = 'solo' | 'two' | 'share' | 'golive' | 'end';

export const STUDIO_LABEL: Record<StudioKey, string> = { solo: 'Solo', two: 'Two up', share: 'Share', golive: 'Go live', end: 'End show' };

/** A key that starts or ends the broadcast: it needs a second click. */
export const needsConfirm = (k: StudioKey): boolean => k === 'golive' || k === 'end';

/** How long the second click may take. Rust asks for `confirm` too. */
export const STUDIO_CONFIRM_MS = 3000;

export type PickState = 'none' | 'several' | 'waiting' | 'picked' | 'minimized';
export interface PickStatus {
  state: PickState;
  browser: keyof typeof BROWSER_NAME | null;
  /** The window in use still has StreamYard in its title. */
  studio?: boolean;
}
export interface Sent {
  key: StudioKey;
  at: number;
}

export const BROWSER_NAME = { firefox: 'Firefox', chrome: 'Chrome', edge: 'Edge', brave: 'Brave', vivaldi: 'Vivaldi', opera: 'Opera' } as const;

/** Find window is always there. It is the prominent button when the wall has no single window of its own (none found, several found, or a find waiting) and a quiet one while a window is in use. */
export const needsFind = (s: PickStatus['state']): boolean => s === 'none' || s === 'several' || s === 'waiting';

/** One short line per refusal word Rust gives; each fits the heading (at most STUDIO_FULL_MAX letters). */
export function refusalText(e: unknown): string {
  const w = typeof e === 'string' ? e : e instanceof Error ? e.message : '';
  switch (w) {
    case 'no studio window':
      return 'Open StreamYard, or press Find window';
    case 'not streamyard':
      return 'Switch that window to the StreamYard tab';
    case 'not set up':
      return 'Set a hotkey in StreamYard Settings, Hotkeys';
    case 'gone':
      return 'The studio window is gone; press Find window';
    case 'not forward':
      return 'The studio window would not come forward';
    case 'busy':
      return 'Another key is still sending';
    case 'needs confirm':
      return 'Click again to confirm';
    default:
      return 'The key was not sent';
  }
}

/** "just now", "2 min ago". */
export function agoText(at: number, now: number): string {
  const min = Math.floor(Math.max(0, now - at) / 60_000);
  return min < 1 ? 'just now' : `${min} min ago`;
}

/** The step a "not found" (or a page error) failed at, as the add-on says it. */
export type StudioWhy = 'tabs' | 'no scenes' | 'several' | 'not usable' | 'too many leaves' | 'no card' | 'no leaf match' | 'no button' | 'unreadable' | 'error';

/** What the Stage Pop-out add-on answered to a scene, mute or camera key. */
export interface StudioAnswer {
  ok: boolean;
  reason: 'ok' | 'already' | 'busy' | 'not found' | 'studio not open' | 'not connected' | 'no answer' | 'refused' | 'failed';
  /** For a miss, which step failed; absent from an older add-on. */
  why?: StudioWhy;
  /** A count that goes with `why`: studio tabs, scenes or buttons. */
  n?: number;
  /** For a mute or camera key that went through: the mic or camera after the press ("off" is muted or camera off). Absent from an older add-on. */
  state?: DeviceState;
}

/** The mic or camera as the add-on last reported it. */
export type DeviceState = 'on' | 'off';

/** The longest heading line a studio answer may give, so it fits the heading at 18 px beside Find window. */
export const STUDIO_FULL_MAX = 44;

/**
 * A short reason for the key face (it fits a key at 16 px) and a full line for the heading. A "not found" says in
 * words which step failed when the add-on tells it: several studio tabs, no scenes shown, no name match, several
 * matches, a hidden button, and so on.
 */
export function studioAnswerText(a: StudioAnswer, action?: 'scene' | 'mute' | 'camera'): { short: string; full: string } {
  const thing = action === 'camera' ? 'camera' : 'mic';
  const n = typeof a.n === 'number' && Number.isInteger(a.n) && a.n >= 0 ? a.n : null;
  if (a.ok && (a.state === 'on' || a.state === 'off') && (action === 'mute' || action === 'camera')) {
    const off = a.state === 'off';
    if (action === 'camera') return off ? { short: 'Camera off', full: 'The camera is off' } : { short: 'Camera on', full: 'The camera is on' };
    return off ? { short: 'Mic muted', full: 'The mic is muted' } : { short: 'Mic live', full: 'The mic is live' };
  }
  switch (a.reason) {
    case 'already':
      return action === 'camera' ? { short: 'Already off', full: 'The camera is already off' } : { short: 'Already muted', full: 'The mic is already muted' };
    case 'busy':
      return { short: 'Busy', full: 'Another studio key is still working' };
    case 'ok':
      return { short: 'Sent', full: 'Sent to StreamYard' };
    case 'not found':
      switch (a.why) {
        case 'tabs':
          return n !== null && n > 1
            ? { short: `${n} tabs open`, full: `${n} StreamYard studio tabs open; close one` }
            : { short: 'Tabs open', full: 'Several StreamYard studio tabs are open' };
        case 'no scenes':
          return { short: 'No scenes', full: 'Open the Scenes panel in StreamYard' };
        case 'no card':
          return { short: 'Unreadable', full: n ? `Could not read the ${n} StreamYard scenes` : 'Could not read the StreamYard scenes' };
        case 'too many leaves':
          return { short: 'Unreadable', full: 'That scene card has too much text to read' };
        case 'no leaf match':
          return { short: 'No match', full: n ? `None of the ${n} scenes has that exact name` : 'No StreamYard scene has that exact name' };
        case 'several':
          if (action === 'scene') return { short: n ? `${n} matches` : 'Several', full: n ? `${n} StreamYard scenes have that name` : 'Several StreamYard scenes have that name' };
          return { short: n ? `${n} buttons` : 'Several', full: n ? `StreamYard shows ${n} ${thing} buttons` : `StreamYard shows several ${thing} buttons` };
        case 'not usable':
          return { short: 'Hidden', full: action === 'scene' ? 'That scene button is hidden or turned off' : `The ${thing} button is hidden or turned off` };
        case 'no button':
          return { short: 'No button', full: `StreamYard shows no ${thing} button` };
        case 'unreadable':
          return { short: 'Unreadable', full: `Could not tell if the ${thing} is on or off` };
        default:
          return { short: 'Not found', full: action === 'scene' ? 'StreamYard has no scene by that name' : `StreamYard shows no ${thing} button` };
      }
    case 'studio not open':
      return { short: 'Studio closed', full: 'No StreamYard studio is open in Firefox' };
    case 'not connected':
      return { short: 'Add-on off', full: 'The Stage Pop-out add-on is not connected' };
    case 'no answer':
      return { short: 'No answer', full: 'The add-on did not answer in time' };
    case 'failed':
      return a.why === 'error' ? { short: 'Page error', full: 'The StreamYard page gave an error' } : { short: 'Not sent', full: 'The key was not sent' };
    default:
      return { short: 'Not sent', full: 'The key was not sent' };
  }
}

/** How long a reason stays on a key; it fades over that time. */
export const NOTE_MS = 2500;
