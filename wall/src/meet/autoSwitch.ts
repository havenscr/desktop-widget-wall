import { usePlaceStore, type PlaceId } from '../state/places';
import { useSignalStore } from '../signals/store';

/** The places a call start may leave: never On Air (a show is running) or Zen (calm). */
const FROM: ReadonlySet<PlaceId> = new Set<PlaceId>(['work', 'home', 'unwind', 'meet']);

/**
 * Opens Meet by itself when a call starts: `call` goes from none to a call, the place is Work, Home, Unwind or
 * Meet, and the page is visible. Once for each call (a later change of kind or camera inside the same call does
 * nothing), and it never switches back. Returns the stop function.
 */
export function startAutoSwitch(visible: () => boolean = () => !document.hidden): () => void {
  let last: number | null = null;
  return useSignalStore.subscribe((s, prev) => {
    const since = s.call?.since ?? null;
    if (since === null) {
      last = null;
      return;
    }
    // A call that was already running is not a start.
    if (prev.call !== null) return;
    if (since === last) return;
    last = since;
    const { active, setActive } = usePlaceStore.getState();
    if (!FROM.has(active) || !visible()) return;
    if (active !== 'meet') setActive('meet');
  });
}
