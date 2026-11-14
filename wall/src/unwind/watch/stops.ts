/**
 * Everything that ends a video by itself. Each is a reason the frame is removed (never just
 * hidden). Leaving the Watch tab or Unwind is not one: the video plays on out of sight and is
 * there, still playing, when the owner comes back (`StageLayer.tsx`).
 */
export interface StopInputs {
  /** The page is shown (`document.hidden` is false). */
  visible: boolean;
  /** The display is off or Windows is locked (`useDisplayDark`). Input idle never stops a video. */
  displayDark: boolean;
  /** The wall's own Screens off mode is on (`monitors-off-mode`). */
  screensOff: boolean;
  /** The signals store's `call` is not null. */
  inCall: boolean;
}

export type StopReason = 'hidden' | 'display' | 'screens-off' | 'call';

/**
 * Why a video must stop now, or null while it may play. Nothing here ever starts a video: once
 * stopped it stays stopped until the owner clicks play.
 */
export function stopReason(s: StopInputs): StopReason | null {
  if (!s.visible) return 'hidden';
  if (s.displayDark) return 'display';
  if (s.screensOff) return 'screens-off';
  if (s.inCall) return 'call';
  return null;
}

/** A short line for the left block after a stop the owner did not ask for. */
export function stopLine(r: StopReason): string {
  switch (r) {
    case 'display':
      return 'Stopped when the display went off or Windows locked.';
    case 'screens-off':
      return 'Stopped when the screens went off.';
    case 'call':
      return 'Stopped for your call.';
    case 'hidden':
      return 'Stopped while the wall was hidden.';
  }
}
