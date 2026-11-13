import { DateLine } from '../unwind/DateLine';
import { Player } from '../unwind/Player';
import { RoomCard } from '../unwind/RoomCard';
import { StatusLine } from '../unwind/StatusLine';
import { LISTEN_PANEL_ID, LISTEN_TAB_ID, Tabs } from '../unwind/Tabs';
import { Tomorrow } from '../unwind/Tomorrow';
import { UNWIND_ROOM_HEIGHT, UNWIND_ROOM_TOP } from './frameLayout';
import { ScreensOff } from '../ui/ScreensOff';
import { reviewDate, reviewNow } from '../ui/reviewClock';

/**
 * The Unwind place, laid out as `f_unwind` on the tall frame (no ribbon) in the wide
 * zones `470px 1fr 540px`. Left wing: the clock (drawn by the frame), "Wednesday night,
 * 49° and clear", Tomorrow (the wind down ring, PR 10, goes between them), with the status line and
 * Screens off along the bottom. Centre: the Listen, Watch and Dream tabs over now playing.
 * The centre's `.u-listen` row holds the player alone for now; the music browser (PR 37)
 * sits beside it there. Right wing: the Room card (Live now, PR 27, will stack above it).
 * The moon, the ridgelines and Watt are drawn by the horizon and buddy layers.
 */
export function Unwind() {
  return (
    <section className="unwind zones wide" data-place="unwind" aria-label="Unwind">
      <div className="u-wing">
        <DateLine now={reviewDate} />
        <div className="u-foot">
          <Tomorrow now={reviewNow} />
          <div className="u-footrow">
            <StatusLine />
            <ScreensOff />
          </div>
        </div>
      </div>
      <div className="u-centre">
        <Tabs />
        <div className="u-listen" role="tabpanel" id={LISTEN_PANEL_ID} aria-labelledby={LISTEN_TAB_ID}>
          <Player />
        </div>
      </div>
      <div className="u-right" style={{ ['--room-top' as string]: `${UNWIND_ROOM_TOP}px`, ['--room-height' as string]: `${UNWIND_ROOM_HEIGHT}px` }}>
        <RoomCard />
      </div>
    </section>
  );
}
