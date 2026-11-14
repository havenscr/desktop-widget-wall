import { useEffect, useState } from 'react';
import { NotesCard } from './NotesCard';
import { RightColumn } from './RightColumn';
import { RunOfShow } from './RunOfShow';
import { useOnAirStore } from './store';
import { TimerBlock } from './TimerBlock';
import { localDate, untilMidnight } from './model';
import { useAwake, useNow } from './useNow';

/**
 * On Air, first version: a show timer started and stopped by hand, the run of show from
 * `run-of-show.txt`, the current part's notes with Previous and Next part, Mark a moment and the
 * key deck's recording keys. Nothing here needs a stream service. The run of show is read when
 * the place opens and on Reload, never more often than every five seconds.
 */
export function OnAir() {
  const now = useNow();
  const awake = useAwake();
  const [day, setDay] = useState(() => localDate(Date.now()));
  useEffect(() => {
    const s = useOnAirStore.getState();
    s.hydrate();
    void s.loadShow();
    // Closing the place drops a read of the run of show that Open file was waiting to make.
    return () => useOnAirStore.getState().cancelPending();
  }, []);
  // The timer stops itself at 24 hours.
  useEffect(() => {
    useOnAirStore.getState().settle();
  }, [now]);
  // Today's marks: read when the place opens, and again after local midnight (one timer to the next
  // midnight; nothing while the page is hidden, and a read on coming back if the date moved on).
  useEffect(() => {
    if (!awake) return;
    const s = useOnAirStore.getState();
    if (s.marksDate !== localDate(Date.now())) void s.loadMarks();
    const id = setTimeout(() => {
      setDay(localDate(Date.now()));
      void useOnAirStore.getState().loadMarks();
    }, untilMidnight(Date.now()) + 50);
    return () => clearTimeout(id);
  }, [awake, day]);
  return (
    <section className="onair" data-place="onair" aria-label="On air">
      <div className="oa-left">
        <TimerBlock now={now} />
        <RunOfShow now={now} />
      </div>
      <NotesCard />
      <RightColumn />
    </section>
  );
}
