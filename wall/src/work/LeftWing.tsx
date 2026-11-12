import { FocusMini } from '../focus/FocusTimer';
import { MachinesReadout } from '../machines/MachinesReadout';
import { MusicMini } from '../music/MusicBar';
import { reviewNow } from '../ui/reviewClock';
import { nextLine, shortClock } from './next';
import { useNextMeeting } from './useNextMeeting';

/**
 * The next meeting that has not ended: title and "12:00, in 1 h 36 m". Hidden when there is
 * none or Meet is not set up. A list that may be out of date is dimmed, with a quiet
 * "as of H:MM" (the last complete read) under it.
 */
function NextBlock() {
  const { meeting, now, stale, asOf } = useNextMeeting(reviewNow);
  if (!meeting) return null;
  return (
    <section className={`blk next${stale ? ' stale' : ''}`} aria-label="Next meeting">
      <span className="k">Next</span>
      <div className="t1 ellipsis">{meeting.title}</div>
      <div className="s">{nextLine(meeting, now)}</div>
      {stale && <div className="xs next-asof">{asOf === null ? 'may be out of date' : `as of ${shortClock(asOf)}`}</div>}
    </section>
  );
}

/**
 * The Work left wing under the clock (concept `f_work`, owner vote A for the machines):
 * Next, the focus row, now playing, and the PC and box numbers at the bottom. The clock
 * and the date line (with the weather) are the frame's, above this.
 */
export function LeftWing() {
  return (
    <div className="wing wl left-wing">
      <NextBlock />
      <FocusMini />
      <MusicMini />
      <MachinesReadout />
    </div>
  );
}
