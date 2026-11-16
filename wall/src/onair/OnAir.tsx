import { NotesCard } from './NotesCard';
import { RightColumn } from './RightColumn';
import { RunOfShow } from './RunOfShow';
import { TimerBlock } from './TimerBlock';
import { OnAir2 } from './v2/OnAir2';
import { useOnAirLoad } from './useOnAirLoad';
import { useNow } from './useNow';

/** The new frame is reachable only in development, with `?onair=v2`. Vite turns `import.meta.env.DEV` into false in a production build, so the new frame and everything only it imports drop out of the bundle. */
const V2 = import.meta.env.DEV && new URLSearchParams(window.location.search).get('onair') === 'v2';

/**
 * On Air, first version: a show timer started and stopped by hand, the run of show from
 * `run-of-show.txt`, the current part's notes with Previous and Next part, Mark a moment and the
 * key deck's recording keys. Nothing here needs a stream service. The run of show is read when
 * the place opens and on Reload, never more often than every five seconds.
 */
export function OnAir() {
  if (V2) return <OnAir2 />;
  const now = useNow();
  useOnAirLoad(now);
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
