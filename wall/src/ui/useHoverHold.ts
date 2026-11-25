import { useCallback, useEffect, useRef, useState } from 'react';

/** True when the focus on `el` is a keyboard one; a mouse click's focus does not hold anything open. A browser without the selector counts every focus as keyboard. */
function keyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

export interface HoverHoldOptions {
  /** Wait before the pointer shows it (0 shows at once). */
  openMs: number;
  /** Wait after the pointer and keyboard focus have both left before it hides. */
  closeMs: number;
  /** False keeps it off (and clears it). */
  enabled: boolean;
}

/**
 * A hold that is on while the pointer or keyboard focus is inside `el`: it turns on after `openMs`, and turns off
 * `closeMs` after the pointer and keyboard focus have both left (focus a mouse click left behind does not hold it). The Watch list card's grow and Unwind's work layer share it.
 */
export function useHoverHold(el: HTMLElement | null, { openMs, closeMs, enabled }: HoverHoldOptions) {
  const [active, setActive] = useState(false);
  const inside = useRef(false);
  const openT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = (t: typeof openT) => {
    if (t.current) clearTimeout(t.current);
    t.current = null;
  };
  const start = () => {
    if (openMs <= 0) setActive(true);
    else openT.current = setTimeout(() => ((openT.current = null), setActive(true)), openMs);
  };
  const arm = useCallback(
    (focusTo?: Element | null) => {
      clear(closeT);
      const f = focusTo === undefined ? document.activeElement : focusTo;
      if (inside.current || (el && f && f !== document.body && el.contains(f) && keyboardFocus(f))) return;
      closeT.current = setTimeout(() => setActive(false), closeMs);
    },
    [el, closeMs],
  );
  useEffect(() => {
    if (!enabled) {
      clear(openT);
      clear(closeT);
      setActive(false);
    } else if (inside.current && !openT.current) {
      // Enabled while the pointer is already inside: start the wait now.
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  useEffect(
    () => () => {
      clear(openT);
      clear(closeT);
    },
    [],
  );
  return {
    active: active && enabled,
    handlers: {
      onPointerEnter: () => {
        inside.current = true;
        clear(closeT);
        if (enabled && !active && !openT.current) start();
      },
      onPointerLeave: () => {
        inside.current = false;
        clear(openT);
        if (active) arm();
      },
      onBlurCapture: (e: { relatedTarget: EventTarget | null }) => {
        if (active && !inside.current) arm(e.relatedTarget as Element | null);
      },
      onFocusCapture: () => clear(closeT),
    },
  };
}
