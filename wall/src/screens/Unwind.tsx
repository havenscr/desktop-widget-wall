import { useEffect, useState } from 'react';
import { DateLine } from '../unwind/DateLine';
import { Player } from '../unwind/Player';
import { SpotifyCard } from '../unwind/spotify/SpotifyCard';
import { useSpotifyStatusPoll } from '../unwind/spotify/status';
import { UpNext } from '../unwind/spotify/UpNext';
import { YtUpNext } from '../unwind/ytmusic/YtUpNext';
import { useQueueActive } from '../unwind/ytmusic/queue';
import { StatusLine } from '../unwind/StatusLine';
import { LISTEN_PANEL_ID, LISTEN_TAB_ID, Tabs } from '../unwind/Tabs';
import { Tomorrow } from '../unwind/Tomorrow';
import { UnderClock } from '../unwind/UnderClock';
import { useCoverTintFollow } from '../unwind/useCoverTintFollow';
import { WatchSheet } from '../unwind/watch/Sheet';
import { useWatchStore } from '../unwind/watch/store';
import { useControlsFade, WatchPanel } from '../unwind/watch/Watch';
import { restZone, useWatchRest } from '../unwind/watch/rest';
import { isPlaying } from '../music/model';
import { isKnownPlayer, playerName, sourceKey } from '../music/players';
import { useNowPlaying } from '../music/useNowPlaying';
import { isWallPlayer } from '../unwind/ownSource';
import { useToolsStore } from '../tools/store';
import { useMusicView } from '../unwind/ytmusic/queue';
import { LinesGear } from '../unwind/watch/LinesPanel';
import { WatchCard } from '../unwind/watch/WatchCard';
import { UNWIND_ROOM_HEIGHT, UNWIND_ROOM_TOP } from './frameLayout';
import { OfficeMoods } from '../studio/OfficeMoods';
import { reviewDate, reviewNow } from '../ui/reviewClock';
import { VibeLayer } from '../vibe/VibeLayer';

/** Spotify's status is read only while Listen shows (the card and Up next need it). */
function SpotifyStatusPoll() {
  useSpotifyStatusPoll();
  return null;
}

/**
 * Listen's inactive state: the same rest Watch has (`useControlsFade`: the same 3 s, the same pointer, focus and Tab
 * wake, the same store the Office moods line reads). It may rest only while music plays and the sheet is closed;
 * mounted only with Listen, so it never runs beside Watch's own.
 */
/** Something that takes Escape first is open: a library menu, a dialog or menu, Watt's menu, or a text field in the music card has focus. */
function listenHeld(): boolean {
  if (useToolsStore.getState().open) return true;
  if (document.querySelector('.u-lib-menu, [role="dialog"], [role="menu"], .watt-menu')) return true;
  const el = document.activeElement;
  return el instanceof HTMLElement && !!el.closest('.sp-card') && el.matches('input, textarea, select');
}

/** True while Spotify or the wall's own YouTube Music plays; a Watch video playing out of sight never counts. */
function useMusicPlaying(): boolean {
  const { info } = useNowPlaying();
  const music = useMusicView();
  const watchPlaying = useWatchStore((s) => s.playing);
  const source = sourceKey(info);
  const own = isWallPlayer(playerName(source)) || (source !== null && !isKnownPlayer(source));
  return (isPlaying(info) && !(own && watchPlaying !== null)) || music?.state === 'playing';
}

function ListenRest() {
  const sheet = useWatchStore((s) => s.sheet);
  const toolsOpen = useToolsStore((s) => s.open);
  const cardHeld = useWatchRest((s) => s.cardHeld);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const look = () => setOpen(listenHeld());
    const watch = new MutationObserver(look);
    watch.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('focusin', look);
    document.addEventListener('focusout', look);
    look();
    return () => {
      watch.disconnect();
      document.removeEventListener('focusin', look);
      document.removeEventListener('focusout', look);
    };
  }, []);
  const music = useMusicView();
  const canRest = useMusicPlaying() && !sheet && !toolsOpen && !cardHeld && !open && !music?.needsClick;
  const { wake } = useControlsFade(canRest, false);
  // Tab wakes the controls, as on Watch (`useWatchKeys`); nothing is listening while Listen cannot rest.
  useEffect(() => {
    if (!canRest) return;
    const tab = (e: KeyboardEvent) => {
      if (e.key === 'Tab') wake();
    };
    document.addEventListener('keydown', tab, true);
    return () => document.removeEventListener('keydown', tab, true);
  }, [canRest, wake]);
  return null;
}

/**
 * The Unwind place: music on the computer, never the house. Left wing: the clock (drawn by
 * the frame), "Wednesday night, 49° and clear", the Listen and Watch toggles under it, then
 * Up next on Listen; Tomorrow and the status line along the bottom. Centre on Listen (7A):
 * the cover and title at the top with the controls in one row under the title, the dancing
 * lines clear below (tinted by the cover). Upper right on Listen (6A): the Spotify card, or
 * YouTube Music with its switch. On Watch: video in the sky with its gear in the left block, and the Watch list
 * in the right wing. The foot of the right side holds the Office moods row (`data-slot="office-lights"`,
 * office only: Unwind never controls any other room).
 * The moon, the ridgelines and Watt are drawn by the horizon and buddy layers.
 */
export function Unwind() {
  const tab = useWatchStore((s) => s.tab);
  const sheet = useWatchStore((s) => s.sheet);
  const watch = tab === 'watch';
  const wallMusic = useQueueActive();
  useCoverTintFollow();
  const listenRest = useWatchRest((s) => s.rest) && !watch;
  return (
    <section className="unwind zones wide" data-place="unwind" data-tab={tab} data-listen-rest={listenRest ? 'true' : undefined} aria-label="Unwind">
      {/* The vibe's back layer sits behind everything here (z-index -1) and runs on Listen and Watch alike. */}
      <VibeLayer />
      {watch ? null : <ListenRest />}
      <div className="u-wing">
        <DateLine now={reviewDate} />
        <Tabs />
        <UnderClock />
        {watch ? null : wallMusic ? <YtUpNext rows={1} /> : <UpNext rows={1} />}
        <div className="u-foot">
          <Tomorrow now={reviewNow} />
          <StatusLine />
        </div>
      </div>
      <div className="u-centre">
        {watch ? (
          <WatchPanel />
        ) : (
          <>
            {/* lines controls: the gear on Listen opens the sheet on its Lines side. */}
            <div className="u-tabrow u-listen-gear" {...restZone('gear')}>
              <LinesGear />
            </div>
            <div className="u-listen" role="tabpanel" id={LISTEN_PANEL_ID} aria-labelledby={LISTEN_TAB_ID} {...restZone('now')}>
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
      {/* The Office moods row: the office-lights slot itself, empty (and aria-hidden) until the home app lists moods.
          Unwind never controls any other room than the office. Hide screen is the app's one corner control, not Unwind's. */}
      <OfficeMoods />
      <div className="u-right" style={{ ['--room-top' as string]: `${UNWIND_ROOM_TOP}px`, ['--room-height' as string]: `${UNWIND_ROOM_HEIGHT}px` }}>
        {watch ? <WatchCard /> : null}
      </div>
      {sheet ? <WatchSheet initial={watch ? 'looks' : 'lines'} /> : null}
    </section>
  );
}
