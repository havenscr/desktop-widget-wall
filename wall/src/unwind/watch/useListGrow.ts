import { useCallback, useEffect, useRef, useState } from 'react';
import { TALL_CLOSE_MS, TALL_OPEN_MS } from '../spotify/model';

/**
 * The Watch list card grows while the pointer rests on it, the way Listen's card does: it opens after the same
 * wait (TALL_OPEN_MS) and closes the same moment after the pointer and keyboard focus have both left (TALL_CLOSE_MS).
 * `enabled` is false in the editor, the follow view, search and the empty card, which keep their own sizes.
 */
export function useListGrow(card: HTMLElement | null, enabled: boolean) {
  const [grown, setGrown] = useState(false);
  const inside = useRef(false);
  const openT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = (t: typeof openT) => {
    if (t.current) clearTimeout(t.current);
    t.current = null;
  };
  const arm = useCallback(
    (focusTo?: Element | null) => {
      clear(closeT);
      const f = focusTo === undefined ? document.activeElement : focusTo;
      if (inside.current || (card && f && f !== document.body && card.contains(f))) return;
      closeT.current = setTimeout(() => setGrown(false), TALL_CLOSE_MS);
    },
    [card],
  );
  useEffect(() => {
    if (!enabled) {
      clear(openT);
      clear(closeT);
      setGrown(false);
    }
  }, [enabled]);
  useEffect(
    () => () => {
      clear(openT);
      clear(closeT);
    },
    [],
  );
  return {
    grown: grown && enabled,
    handlers: {
      onPointerEnter: () => {
        inside.current = true;
        clear(closeT);
        if (enabled && !grown && !openT.current) openT.current = setTimeout(() => ((openT.current = null), setGrown(true)), TALL_OPEN_MS);
      },
      onPointerLeave: () => {
        inside.current = false;
        clear(openT);
        if (grown) arm();
      },
      onBlurCapture: (e: { relatedTarget: EventTarget | null }) => {
        if (grown && !inside.current) arm(e.relatedTarget as Element | null);
      },
      onFocusCapture: () => clear(closeT),
    },
  };
}
