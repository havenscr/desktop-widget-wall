import { usePlaceStore } from '../state/places';
import { WATCH_PANEL_ID, WATCH_TAB_ID } from './watch/Watch';
import { useWatchStore } from './watch/store';

/** The Listen tab's panel; `Unwind.tsx` gives the player row this id. */
export const LISTEN_PANEL_ID = 'u-panel-listen';
export const LISTEN_TAB_ID = 'u-tab-listen';

/**
 * Listen, Watch and Dream (concept `.seg3`). Listen and Watch switch the centre between the
 * music player and video (leaving Watch removes any video). Dream opens Zen straight into
 * Dream. None of them moves the horizon camera while Unwind is shown.
 */
export function Tabs() {
  const tab = useWatchStore((s) => s.tab);
  const setTab = useWatchStore((s) => s.setTab);
  return (
    <div className="u-tabs" role="tablist" aria-label="Unwind">
      <button
        type="button"
        role="tab"
        id={LISTEN_TAB_ID}
        aria-selected={tab === 'listen'}
        aria-controls={LISTEN_PANEL_ID}
        className={`u-tab${tab === 'listen' ? ' on' : ''}`}
        onClick={() => setTab('listen')}
      >
        Listen
      </button>
      <button
        type="button"
        role="tab"
        id={WATCH_TAB_ID}
        aria-selected={tab === 'watch'}
        aria-controls={WATCH_PANEL_ID}
        className={`u-tab${tab === 'watch' ? ' on' : ''}`}
        onClick={() => setTab('watch')}
      >
        Watch
      </button>
      <button type="button" role="tab" aria-selected="false" className="u-tab" onClick={() => usePlaceStore.getState().openDream()}>
        Dream
      </button>
    </div>
  );
}
