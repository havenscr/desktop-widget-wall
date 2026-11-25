import { useHoverHold } from '../../ui/useHoverHold';
import { TALL_CLOSE_MS, TALL_OPEN_MS } from '../spotify/model';

/**
 * The Watch list card grows while the pointer rests on it, the way Listen's card does: it opens after the same
 * wait (TALL_OPEN_MS) and closes the same moment after the pointer and keyboard focus have both left (TALL_CLOSE_MS).
 * `enabled` is false in the editor, the follow view, search and the empty card, which keep their own sizes.
 */
export function useListGrow(card: HTMLElement | null, enabled: boolean) {
  const { active, handlers } = useHoverHold(card, { openMs: TALL_OPEN_MS, closeMs: TALL_CLOSE_MS, enabled });
  return { grown: active, handlers };
}
