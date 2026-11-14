import { useEffect } from 'react';
import { NotesCard } from './NotesCard';
import { RightColumn } from './RightColumn';
import { RunOfShow } from './RunOfShow';
import { useOnAirStore } from './store';
import { TimerBlock } from './TimerBlock';
import { useNow } from './useNow';

/**
 * On Air, first version: a show timer started and stopped by hand, the run of show from
 * `run-of-show.txt`, the current part's notes with Previous and Next part, Mark a moment and the
 * key deck's recording keys. Nothing here needs a stream service. The run of show is read when
 * the place opens and on Reload, never more often than every five seconds.
 */
export function OnAir() {
  const now = useNow();
  useEffect(() => {
    const s = useOnAirStore.getState();
    s.hydrate();
    void s.loadShow();
    void s.loadMarks();
  }, []);
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
