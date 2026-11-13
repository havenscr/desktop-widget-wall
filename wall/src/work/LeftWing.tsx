import { useCentreShowsFocus } from '../agents/CentreSlot';
import { FocusMini } from '../focus/FocusTimer';
import { MachinesReadout } from '../machines/MachinesReadout';
import { MusicMini } from '../music/MusicBar';
import { reviewNow } from '../ui/reviewClock';
import { nextLine, shortClock } from './next';
import { useNextMeeting } from './useNextMeeting';

/**
 * The next meeting that has not ended: title and "12:00, in 1 h 36 m". Hidden when there is
 * none or Meet is not set up. When no account can be read it says "Calendar not available" in a quiet line. A list that may be out of date is dimmed, drops the
 * countdown, and has a quiet "as of H:MM" (the last complete read) under it.
 */
function NextBlock({ roomy }: { roomy: boolean }) {
  const { meeting, now, stale, asOf, unavailable } = useNextMeeting(reviewNow);
  if (!meeting && unavailable) {
    return (
      <section className="blk next stale" aria-label="Next meeting">
        <span className="k">Next</span>
        <div className="s">Calendar not available</div>
      </section>
    );
  }
  if (!meeting) return null;
  return (
    <section className={`blk next${stale ? ' stale' : ''}`} aria-label="Next meeting">
      <span className="k">Next</span>
      {/* With the Focus row hidden, a long title may take a second line. */}
      <div className={roomy ? 't1 next-two' : 't1 ellipsis'} {...(roomy ? { title: meeting.title } : {})}>
        {meeting.title}
      </div>
      <div className="s">{nextLine(meeting, now, stale)}</div>
      {stale && <div className="xs next-asof">{asOf === null ? 'may be out of date' : `as of ${shortClock(asOf)}`}</div>}
    </section>
  );
}

/**
 * The Work left wing under the clock (concept `f_work`, owner vote A for the machines):
 * Next, the focus row, now playing, and the PC and box numbers at the bottom. The clock
 * and the date line (with the weather) are the frame's, above this. When the centre shows
 * the Focus card, the focus row hides (Focus is shown once) and the next meeting's title may
 * take a second line.
 */
export function LeftWing() {
  const focusInCentre = useCentreShowsFocus();
  return (
    <div className="wing wl left-wing">
      <NextBlock roomy={focusInCentre} />
      {!focusInCentre && <FocusMini />}
      <MusicMini />
      <MachinesReadout />
    </div>
  );
}
