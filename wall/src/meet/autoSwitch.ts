import { usePlaceStore, type PlaceId } from '../state/places';
import { useSignalStore } from '../signals/store';

/** The places a call start may leave: never On Air (a show is running) or Zen (calm). */
const FROM: ReadonlySet<PlaceId> = new Set<PlaceId>(['work', 'home', 'unwind', 'meet']);

/**
 * Opens Meet by itself when a call starts: `call` goes from none to a call, the place is Work, Home, Unwind or
 * Meet, and the page is visible. Once for each call (a later change of kind or camera inside the same call does
 * nothing), and it never switches back. A call that starts while the page is hidden opens Meet once, when the page
 * becomes visible while that same call is still on. Returns the stop function.
 */
export function startAutoSwitch(visible: () => boolean = () => !document.hidden, target: Pick<Document, 'addEventListener' | 'removeEventListener'> = document): () => void {
  // True while a call has started and Meet has not been opened for it because the page was hidden.
  let waiting = false;
  const open = () => {
    const { active, setActive } = usePlaceStore.getState();
    waiting = false;
    if (!FROM.has(active)) return;
    if (active !== 'meet') setActive('meet');
  };
  const unsubscribe = useSignalStore.subscribe((s, prev) => {
    if (s.call === null) {
      waiting = false;
      return;
    }
    // A call that was already running is not a start.
    if (prev.call !== null) return;
    waiting = true;
    if (visible()) open();
  });
  const onVisible = () => {
    if (waiting && visible() && useSignalStore.getState().call !== null) open();
  };
  target.addEventListener('visibilitychange', onVisible);
  return () => {
    unsubscribe();
    target.removeEventListener('visibilitychange', onVisible);
  };
}
