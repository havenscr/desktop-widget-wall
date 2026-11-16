import { IconBookmark, IconNotes, IconPlayerPause, IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlayerRecordFilled, IconPlayerStopFilled } from '@tabler/icons-react';
import { StudioBlock } from '../../studio/StudioBlock';
import { useSignalStore } from '../../signals/store';
import { tip } from '../../ui/HoverTip';
import { NotesCard } from '../NotesCard';
import { useOnAirStore } from '../store';
import { useTakes } from '../takes';
import { takeClock, takeMs, takesLine } from '../takeModel';
import { Head, LibTile, MarkTile, TileRow } from './Tiles';
import { clockText } from './time';
import { useDeckKeys, PAUSE_PRESS_ID } from './useDeckKeys';

/** The outline's note sizes: a little larger than a card of notes in the middle, the list is short. */
const OUTLINE_SIZES = [32, 28, 24, 22] as const;

/** Today's last marks: the show time and the part, three at most, then the takes line and Open marks.txt. */
function MarksBlock() {
  const marks = useOnAirStore((s) => s.marks);
  const note = useOnAirStore((s) => s.marksNote);
  const open = useOnAirStore((s) => s.open);
  const takes = useTakes((s) => s.takes);
  const rows = marks ? marks.last.map((t, i) => ({ t, part: marks.lastParts?.[i] ?? '' })) : [];
  return (
    <div className="oa2-b oa2-marks" role="group" aria-label="Marks today">
      <Head label="Marks today" right="saved to marks.txt" />
      <div className="oa2-rows">
        {rows.length > 0 ? (
          rows.map((r, i) => (
            <div key={i} className="oa2-row" {...tip(`${r.t}${r.part ? ` in ${r.part}` : ''}. Written to marks.txt.`)}>
              <IconBookmark size={20} aria-hidden="true" />
              <span className="oa2-row-t">
                <b>{r.t}</b>
                {r.part ? ` ${r.part}` : ''}
              </span>
            </div>
          ))
        ) : (
          <div className="oa2-row">
            <span className="oa2-row-t">{marks === null ? (note ? 'Today\'s marks are not known.' : 'Reading today\'s marks.') : 'None yet today.'}</span>
          </div>
        )}
      </div>
      <div className={`oa2-fine${note ? ' amber' : ''}`} role="status">
        {note ?? takesLine(takes)}
      </div>
      <button type="button" className="oa-btn sm oa2-open" onClick={() => void open('marks')} {...tip('Open marks.txt in the default editor: one line a mark, with the local time, the show time and the part')}>
        Open marks.txt
      </button>
    </div>
  );
}

/** The take timer: the time of this take, a chip saying Recording or Paused, and one honest line under it. */
function TakeTimer({ now }: { now: number }) {
  const recording = useSignalStore((s) => s.recording);
  const takes = useTakes((s) => s.takes);
  const cur = recording ? takes.current : null;
  const ms = cur ? takeMs(cur, now) : 0;
  const paused = cur !== null && cur.pausedAt !== null;
  const running = cur !== null && !paused;
  const time = takeClock(ms);
  const sub = !cur
    ? 'No recording running. The timer starts with the recorder.'
    : paused
      ? `Take ${takes.count} is paused. The timer waits with the recorder.`
      : `Take ${takes.count}. It started by itself at ${clockText(cur.startedAt)}, when the recorder began.`;
  return (
    <div className="oa2-b oa2-timer oa2-take" role="group" aria-label="Take timer">
      <Head label="Take timer" />
      <div className="oa-time-row">
        <span className="oa-time" data-running={running ? 'true' : 'false'} role="timer" aria-label={`Take time ${time}`} {...tip('Counts from when the wall saw the recorder start. A pause made in the recorder itself cannot be seen.')}>
          {time}
        </span>
        {cur &&
          (paused ? (
            <span className="oa2-chip" data-kind="stale">
              <IconPlayerPause size={18} aria-hidden="true" />
              Paused
            </span>
          ) : (
            <span className="oa2-chip" data-kind="rec">
              <i className="oa2-dot" data-mode="rec" aria-hidden="true" />
              Recording
            </span>
          ))}
      </div>
      <div className="oa2-sub" {...tip(sub)}>
        {sub}
      </div>
    </div>
  );
}

/** Record, Pause or Resume, Stop, Mark a moment, Snip and Hide screen: the deck's keys, in the deck's press path. */
function RecordingKeys({ now }: { now: number }) {
  const keys = useDeckKeys();
  const recording = useSignalStore((s) => s.recording);
  const known = useSignalStore((s) => s.known);
  const takes = useTakes((s) => s.takes);
  const mark = useOnAirStore((s) => s.mark);
  const marking = useOnAirStore((s) => s.marking);
  const cur = recording ? takes.current : null;
  const paused = cur !== null && cur.pausedAt !== null;
  const idle = known && !recording;
  const noRecording = 'No recording is running';
  return (
    <div className="oa2-b oa2-reckeys" role="group" aria-label="Recording keys">
      <Head label="Recording keys" right="sent to the recorder" brief={keys.brief} />
      <TileRow keys={keys} cols={6}>
        <LibTile keys={keys} spec={{ id: 'rec-toggle', pressId: 'onair:rec-record', label: 'Record', icon: IconPlayerRecordFilled, off: recording ? 'A recording is running' : undefined }} />
        <LibTile keys={keys} spec={{ id: 'rec-toggle', pressId: PAUSE_PRESS_ID, label: paused ? 'Resume' : 'Pause', icon: paused ? IconPlayerPlayFilled : IconPlayerPauseFilled, off: recording ? undefined : noRecording }} />
        <LibTile keys={keys} spec={{ id: 'rec-stop', label: 'Stop', icon: IconPlayerStopFilled, stop: recording, off: idle ? 'No recording is running; Stop is sent to the recorder only while one runs' : undefined }} />
        <MarkTile mark={mark} showMs={cur ? takeMs(cur, now) : 0} marking={marking} />
        <LibTile keys={keys} spec={{ id: 'snip' }} />
        <LibTile keys={keys} spec={{ id: 'strip-dark' }} />
      </TileRow>
    </div>
  );
}

/**
 * The Recording page: marks, the outline, the take timer, the recording keys and the studio lights (today's
 * block, unchanged). The prompter's box, under the marks, stays empty until its own pull request.
 */
export function RecordingPage({ now }: { now: number }) {
  return (
    <>
      <MarksBlock />
      {/* The prompter's box (wall 124, 336, 640 by 104) is kept empty: nothing is drawn in it until the prompter's own pull request. */}
      <div className="oa2-b oa2-empty oa2-empty-prompter oa2-empty-rec" aria-hidden="true" />
      <NotesCard title="Outline" right="the script is on the prompter" sizes={OUTLINE_SIZES} icon={<IconNotes size={20} aria-hidden="true" />} className="oa2-outline" />
      <TakeTimer now={now} />
      <RecordingKeys now={now} />
      <div className="oa2-b oa2-lights-rec">
        <StudioBlock />
      </div>
    </>
  );
}
