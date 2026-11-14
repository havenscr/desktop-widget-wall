import { IconDeviceTv, IconHeadphones } from '@tabler/icons-react';
import { WATCH_PANEL_ID, WATCH_TAB_ID } from './watch/Watch';
import { useWatchStore } from './watch/store';

/** The Listen tab's panel; `Unwind.tsx` gives the player this id. */
export const LISTEN_PANEL_ID = 'u-panel-listen';
export const LISTEN_TAB_ID = 'u-tab-listen';

/**
 * Listen and Watch as two toggles under the clock (7A: no tab pill over the centre). They
 * switch the centre between the music player and video (leaving Watch removes any video).
 * Neither moves the horizon camera while Unwind is shown. There is no Dream toggle: Zen dims by
 * itself late at night.
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
        title="Music: what is playing, Up next and Spotify"
        onClick={() => setTab('listen')}
      >
        <IconHeadphones size={22} stroke={1.8} aria-hidden="true" />
        Listen
      </button>
      <button
        type="button"
        role="tab"
        id={WATCH_TAB_ID}
        aria-selected={tab === 'watch'}
        aria-controls={WATCH_PANEL_ID}
        className={`u-tab${tab === 'watch' ? ' on' : ''}`}
        title="Video in the sky: YouTube and Twitch"
        onClick={() => setTab('watch')}
      >
        <IconDeviceTv size={22} stroke={1.8} aria-hidden="true" />
        Watch
      </button>
    </div>
  );
}
