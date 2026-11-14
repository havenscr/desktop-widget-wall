import { DateLine } from '../unwind/DateLine';
import { Player } from '../unwind/Player';
import { SpotifyCard } from '../unwind/spotify/SpotifyCard';
import { useSpotifyStatusPoll } from '../unwind/spotify/status';
import { UpNext } from '../unwind/spotify/UpNext';
import { StatusLine } from '../unwind/StatusLine';
import { LISTEN_PANEL_ID, LISTEN_TAB_ID, Tabs } from '../unwind/Tabs';
import { Tomorrow } from '../unwind/Tomorrow';
import { useCoverTintFollow } from '../unwind/useCoverTintFollow';
import { WatchSheet } from '../unwind/watch/Sheet';
import { useWatchStore } from '../unwind/watch/store';
import { WatchGear, WatchPanel } from '../unwind/watch/Watch';
import { WatchCard } from '../unwind/watch/WatchCard';
import { UNWIND_ROOM_HEIGHT, UNWIND_ROOM_TOP } from './frameLayout';
import { ScreensOff } from '../ui/ScreensOff';
import { reviewDate, reviewNow } from '../ui/reviewClock';

/** Spotify's status is read only while Listen shows (the card and Up next need it). */
function SpotifyStatusPoll() {
  useSpotifyStatusPoll();
  return null;
}

/**
 * The Unwind place: music on the computer, never the house. Left wing: the clock (drawn by
 * the frame), "Wednesday night, 49° and clear", the Listen and Watch toggles under it, then
 * Up next on Listen; Tomorrow and the status line along the bottom. Centre on Listen (7A):
 * the cover and title at the top with the controls in one row under the title, the dancing
 * lines clear below (tinted by the cover). Upper right on Listen (6A): the Spotify card, or
 * YouTube Music with its switch. On Watch: video in the sky with its gear, and the Watch list
 * in the right wing. The lower right holds an empty slot (`data-slot="office-lights"`) kept
 * for an office-only lights control: Unwind never controls any other room.
 * The moon, the ridgelines and Watt are drawn by the horizon and buddy layers.
 */
export function Unwind() {
  const tab = useWatchStore((s) => s.tab);
  const sheet = useWatchStore((s) => s.sheet);
  const watch = tab === 'watch';
  useCoverTintFollow();
  return (
    <section className="unwind zones wide" data-place="unwind" data-tab={tab} aria-label="Unwind">
      <div className="u-wing">
        <DateLine now={reviewDate} />
        <Tabs />
        {watch ? null : <UpNext />}
        <div className="u-foot">
          <Tomorrow now={reviewNow} />
          <StatusLine />
        </div>
      </div>
      <div className="u-centre">
        {watch ? (
          <>
            <div className="u-tabrow">
              <WatchGear />
            </div>
            <WatchPanel />
          </>
        ) : (
          <>
            <div className="u-tabrow u-listen-gear"><WatchGear /></div>
            <div className="u-listen" role="tabpanel" id={LISTEN_PANEL_ID} aria-labelledby={LISTEN_TAB_ID}>
              <Player />
            </div>
          </>
        )}
      </div>
      {watch ? null : (
        <>
          <SpotifyStatusPoll />
          <SpotifyCard />
        </>
      )}
      {/* Kept empty for an office-only lights control (the owner is still choosing it). It takes no
          space and no pointer while empty. Unwind never controls any other room than the office. */}
      <div className="u-office-slot" data-slot="office-lights" aria-hidden="true" />
      <div className="u-corner">
        <ScreensOff />
      </div>
      <div className="u-right" style={{ ['--room-top' as string]: `${UNWIND_ROOM_TOP}px`, ['--room-height' as string]: `${UNWIND_ROOM_HEIGHT}px` }}>
        {watch ? <WatchCard /> : null}
      </div>
      {sheet ? <WatchSheet /> : null}
    </section>
  );
}
