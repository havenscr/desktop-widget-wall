import { usePlaceStore } from '../state/places';

/**
 * Listen, Watch and Dream (concept `.seg3`). Listen is this view. Watch is not built yet
 * and shows "Coming" without opening anything. Dream opens Zen straight into Dream.
 * None of them moves the horizon camera while Unwind is shown.
 */
export function Tabs() {
  return (
    <div className="u-tabs" role="tablist" aria-label="Unwind">
      <button type="button" role="tab" aria-selected="true" className="u-tab on">
        Listen
      </button>
      <button type="button" role="tab" aria-selected="false" aria-disabled="true" className="u-tab off" aria-label="Watch, coming later">
        Watch<span className="u-soon">Coming</span>
      </button>
      <button type="button" role="tab" aria-selected="false" className="u-tab" onClick={() => usePlaceStore.getState().openDream()}>
        Dream
      </button>
    </div>
  );
}
