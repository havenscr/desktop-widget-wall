import type { FocusEvent, PointerEvent } from 'react';
import { create } from 'zustand';

/**
 * The Watch controls' rest, shared with the two things that rest beside them (the Watch list card and the Office
 * moods line): `rest` is true while the left block's controls are faded out, so the card and the line fade with
 * them, with the same timing. `useControlsFade` (Watch.tsx) publishes it and registers the bridge below; a zone
 * outside the left block (the card, the moods row) reports its pointer and focus through `restZone`, and the
 * controls come back (and stay while the pointer or the keyboard is there) as they do for the left block.
 * `cardHeld` is the card saying it is in use (text in its field, a rename, the new playlist form, a menu, a delete question):
 * then it never rests.
 */
export const useWatchRest = create<{ rest: boolean; cardHeld: boolean }>(() => ({ rest: false, cardHeld: false }));

/** How long the controls stay after the pointer or focus leaves them, while something plays (Watch and Listen). */
export const CTL_REST_MS = 3000;
/** Development only: the dev mocks shorten the wait so headless stills catch the faded block. */
export const ctlTiming = { restMs: CTL_REST_MS };

export interface RestBridge {
  enter: (id: string) => void;
  leave: (id: string) => void;
  focus: (id: string, on: boolean) => void;
}
export const restBridge: { current: RestBridge | null } = { current: null };

/** True when the focus on `el` is a keyboard one (`:focus-visible`); a browser without the selector counts every focus as keyboard. */
export function keyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** Pointer and focus handlers for a zone beside the left block: the same rules the left block's own zone follows. */
export function restZone(id: string) {
  return {
    onPointerEnter: () => restBridge.current?.enter(id),
    onPointerLeave: (e: PointerEvent<HTMLElement>) => {
      // A button the mouse clicked keeps focus after the pointer leaves; let it go so it does not hide a live control.
      const el = document.activeElement;
      if (el instanceof HTMLElement && e.currentTarget.contains(el) && !keyboardFocus(el)) el.blur();
      restBridge.current?.leave(id);
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (keyboardFocus(e.target)) restBridge.current?.focus(id, true);
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      const to = e.relatedTarget as Node | null;
      if (to && e.currentTarget.contains(to)) return;
      restBridge.current?.focus(id, false);
    },
  };
}
