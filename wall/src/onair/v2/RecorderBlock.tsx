import { IconVideo } from '@tabler/icons-react';
import { useSignalStore } from '../../signals/store';
import { tip } from '../../ui/HoverTip';
import { useTakes } from '../takes';
import { rollDay } from '../takeModel';
import { recorderWord, useRecorder, useRecorderSync } from './recorderStore';
import { Head } from './Tiles';

const HOVER = 'Sees if the recorder is open and if it holds the mic or camera. A pause made in the recorder is not seen.';

/** The Recording page's box under Marks today: the Camtasia Recorder's state in one line. */
export function RecorderBlock({ now }: { now: number }) {
  useRecorderSync();
  const open = useRecorder((s) => s.open);
  const recording = useSignalStore((s) => s.recording);
  const known = useSignalStore((s) => s.known);
  const takes = rollDay(useTakes((s) => s.takes), now);
  const cur = recording ? takes.current : null;
  const word = recorderWord({ open, recording, paused: cur !== null && cur.pausedAt !== null, known });
  const live = word === 'Recording' || word === 'Paused';
  return (
    <div className="oa2-b oa2-recorder" role="group" aria-label="Camtasia Recorder">
      <Head label="Camtasia Recorder" icon={<IconVideo size={20} aria-hidden="true" />} right="checked every 5 s" />
      <div className="oa2-recstate" role="status" {...tip(HOVER)}>
        <i className="oa2-dot" data-mode={word === 'Recording' ? 'rec' : 'idle'} aria-hidden="true" />
        <b>{word}</b>
        {live && cur && <span>{`take ${takes.count}`}</span>}
      </div>
      <div className="oa2-fine">Not open, Ready, Recording or Paused.</div>
    </div>
  );
}
