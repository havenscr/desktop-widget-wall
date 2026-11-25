import { useEffect, useState } from 'react';
import type { PlaceId } from '../../state/places';
import { useHoverHold } from '../../ui/useHoverHold';
import { useWatchRest } from '../watch/rest';
import { useWatchStore } from '../watch/store';
import { useWorkLayerStore } from './layerStore';

/** The pointer shows the layer at once; it hides this long after the pointer and focus leave. */
export const LAYER_CLOSE_MS = 1500;

/**
 * The work layer's hold on the Unwind frame: the pointer or focus inside the frame shows it, and it hides
 * `LAYER_CLOSE_MS` after both leave. It stays hidden while the Watch controls rest or the sheet is open (a take, a
 * dialog or a menu hide it in CSS, which can see them; the keys row's own menu and picker are exempt and hold it up). Spread `handlers` on the frame element, give `setEl` as its ref.
 */
export function useWorkLayer(place: PlaceId) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const rest = useWatchRest((s) => s.rest);
  const sheet = useWatchStore((s) => s.sheet);
  const on = place === 'unwind' && !rest && !sheet;
  const { active, handlers } = useHoverHold(el, { openMs: 0, closeMs: LAYER_CLOSE_MS, enabled: on });
  // The keys row's menu, picker or rename popover holds the layer up while it is open (not over the sheet or a rest).
  const held = useWorkLayerStore((s) => s.held);
  const shown = on && (active || held);
  useEffect(() => {
    useWorkLayerStore.setState({ shown });
    return () => useWorkLayerStore.setState({ shown: false });
  }, [shown]);
  return { setEl, handlers: place === 'unwind' ? handlers : {} };
}
