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
  /** Which keys have a chord in keys.json. Names only. */
  keys: StudioKey[];
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
      return 'No chord set for that key';
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
