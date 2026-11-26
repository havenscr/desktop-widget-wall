/** The studio keys, in the order of the row. Rust knows the same five names. */
export type StudioKey = 'solo' | 'two' | 'share' | 'golive' | 'end';

export const STUDIO_LABEL: Record<StudioKey, string> = { solo: 'Solo', two: 'Two up', share: 'Share', golive: 'Go live', end: 'End show' };

/** A key that starts or ends the broadcast: it needs a second click. */
export const needsConfirm = (k: StudioKey): boolean => k === 'golive' || k === 'end';

/** How long the second click may take. Rust asks for `confirm` too. */
export const STUDIO_CONFIRM_MS = 3000;

export type PickState = 'none' | 'waiting' | 'picked' | 'gone' | 'minimized';
export interface PickStatus {
  state: PickState;
  browser: 'firefox' | 'chrome' | 'edge' | null;
}
export interface Sent {
  key: StudioKey;
  at: number;
}

export const BROWSER_NAME = { firefox: 'Firefox', chrome: 'Chrome', edge: 'Edge' } as const;

/** One short line per refusal word Rust gives. */
export function refusalText(e: unknown): string {
  const w = typeof e === 'string' ? e : e instanceof Error ? e.message : '';
  switch (w) {
    case 'no studio window':
      return 'Pick the StreamYard window first';
    case 'not streamyard':
      return 'Switch that window to the StreamYard tab';
    case 'not set up':
      return 'StreamYard has no hotkey for that key. Set one in StreamYard Settings, Hotkeys';
    case 'gone':
      return 'The studio window is gone. Pick it again';
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

/** What the Stage Pop-out add-on answered to a scene, mute or camera key. */
export interface StudioAnswer {
  ok: boolean;
  reason: 'ok' | 'already' | 'busy' | 'not found' | 'studio not open' | 'not connected' | 'no answer' | 'refused' | 'failed';
}

/** A short reason for the key face (it fits a key at 16 px) and a full line for the heading. */
export function studioAnswerText(a: StudioAnswer, action?: 'scene' | 'mute' | 'camera'): { short: string; full: string } {
  switch (a.reason) {
    case 'already':
      return action === 'camera' ? { short: 'Already off', full: 'The camera is already off' } : { short: 'Already muted', full: 'The mic is already muted' };
    case 'busy':
      return { short: 'Busy', full: 'Another studio key is still working' };
    case 'ok':
      return { short: 'Sent', full: 'Sent to StreamYard' };
    case 'not found':
      return { short: 'Not found', full: 'StreamYard has no scene or button by that name' };
    case 'studio not open':
      return { short: 'Studio closed', full: 'No StreamYard studio is open in Firefox' };
    case 'not connected':
      return { short: 'Add-on off', full: 'The Stage Pop-out add-on is not connected' };
    case 'no answer':
      return { short: 'No answer', full: 'The add-on did not answer in time' };
    default:
      return { short: 'Not sent', full: 'The key was not sent' };
  }
}

/** How long a reason stays on a key; it fades over that time. */
export const NOTE_MS = 2500;
