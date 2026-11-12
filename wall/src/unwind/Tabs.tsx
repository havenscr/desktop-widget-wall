import { usePlaceStore } from '../state/places';

/** The Listen tab's panel; `Unwind.tsx` gives the player row this id. */
export const LISTEN_PANEL_ID = 'u-panel-listen';
export const LISTEN_TAB_ID = 'u-tab-listen';

/**
 * Listen, Watch and Dream (concept `.seg3`). Listen is this view and controls the player
 * panel. Watch is not built yet: disabled (not focusable), with "Coming", opening nothing.
 * Dream opens Zen straight into Dream. None of them moves the horizon camera while Unwind
 * is shown.
 */
export function Tabs() {
  return (
    <div className="u-tabs" role="tablist" aria-label="Unwind">
      <button type="button" role="tab" id={LISTEN_TAB_ID} aria-selected="true" aria-controls={LISTEN_PANEL_ID} className="u-tab on">
        Listen
      </button>
      <button type="button" role="tab" aria-selected="false" disabled className="u-tab off" aria-label="Watch, coming later">
        Watch<span className="u-soon">Coming</span>
      </button>
      <button type="button" role="tab" aria-selected="false" className="u-tab" onClick={() => usePlaceStore.getState().openDream()}>
        Dream
      </button>
    </div>
  );
}
