import { IconBookmark, IconDeviceDesktopOff, IconFileText, IconPlayerRecordFilled, IconPlayerStopFilled, IconScreenshot, type Icon } from '@tabler/icons-react';
import { useSignalStore } from '../signals/store';
import { tip } from '../ui/HoverTip';
import { libKeyKind } from '../work/keyKind';
import { useKeyPress } from '../work/keyPress';
import { useBrief } from '../work/useBrief';
import { markLine } from './model';
import { useOnAirStore } from './store';

/** Mark a moment: one line in marks.txt with the show time and the part; today's count and last times under it. */
function MarkTile() {
  const marks = useOnAirStore((s) => s.marks);
  const note = useOnAirStore((s) => s.note);
  const marking = useOnAirStore((s) => s.marking);
  const mark = useOnAirStore((s) => s.mark);
  const open = useOnAirStore((s) => s.open);
  const line = note ?? markLine(marks);
  return (
    <div className="oa-mark" data-note={note ? 'true' : undefined}>
      <button
        type="button"
        className="oa-mark-btn"
        aria-busy={marking}
        onClick={(e) => {
          // One mark for a double click: the second click of a pair never counts.
          if (e.detail > 1) return;
          void mark();
        }}
        {...tip('Write the show time and the current part to marks.txt, for cutting Shorts later. The count and times under it are today\'s. A second click within a second counts once.')}
      >
        <span className="oa-mark-ico" aria-hidden="true">
          <IconBookmark size={26} />
        </span>
        <span className="oa-mark-tx">
          <span className="oa-mark-t">Mark a moment</span>
          <span className={`xs oa-mark-s ellipsis${note ? ' amber' : ''}`} role="status">
            {line}
          </span>
        </span>
      </button>
      <button type="button" className="oa-btn oa-mark-open" aria-label="Open marks.txt" onClick={() => void open('marks')} {...tip('Open marks.txt in the default editor: one line a mark, with the local time, the show time and the part')}>
        <IconFileText size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

/** One recording key: a key of the built-in library, sent by its id through the deck's own press path. */
interface OnAirKey {
  id: 'record-169' | 'rec-stop' | 'snip' | 'strip-dark';
  /** The library group, for its colour (keyKind.ts). */
  group: string;
  /** The wall action the key runs, or null for a key Rust sends. */
  action: string | null;
  label: string;
  icon: Icon;
  where: { name: string; general: boolean };
  tip: string;
}

/** The four keys the picture draws, in order: the library's Record 16:9, Stop, Snip and Hide screen. */
export const ONAIR_KEYS: readonly OnAirKey[] = [
  { id: 'record-169', group: 'windows', action: 'layout:record169', label: 'Record 16:9', icon: IconPlayerRecordFilled, where: { name: 'the app in front', general: true }, tip: 'Make the front window a 16:9 box to record (the key deck\'s Record 16:9)' },
  { id: 'rec-stop', group: 'recording', action: null, label: 'Stop', icon: IconPlayerStopFilled, where: { name: 'the recorder', general: false }, tip: 'Stop the recording (sent to the recorder only while one is running)' },
  { id: 'snip', group: 'anywhere', action: null, label: 'Snip', icon: IconScreenshot, where: { name: 'the app in front', general: true }, tip: 'Take a screen snip' },
  { id: 'strip-dark', group: 'anywhere', action: 'screens-off', label: 'Hide screen', icon: IconDeviceDesktopOff, where: { name: 'the wall', general: true }, tip: 'Hide the screens until the mouse moves (the wall\'s own Hide screen)' },
];

/** The recording keys, from the key deck: its tiles, its colours, its press path. */
function RecordingKeys() {
  const recording = useSignalStore((s) => s.recording);
  const known = useSignalStore((s) => s.known);
  const [brief, showBrief] = useBrief();
  const { press, onKeyDown } = useKeyPress(showBrief, () => {});
  return (
    <>
      {brief ? (
        <span className="oa-k-brief oa-keys-hd ellipsis" role="status" {...tip(brief)}>
          {brief}
        </span>
      ) : (
        <span className="k oa-k oa-keys-hd">Recording keys, from the key deck</span>
      )}
      <div className="deck-tiles keys-tiles oa-keys">
        {ONAIR_KEYS.map((k) => {
          const I = k.icon;
          // Stop agrees with recording mode: lit red while a recorder runs, plain and saying so when none does.
          const idleStop = k.id === 'rec-stop' && known && !recording;
          const text = k.id === 'rec-stop' ? (recording ? 'Stop the recording that is running now' : idleStop ? 'No recording is running; Stop is sent to the recorder only while one runs' : k.tip) : k.tip;
          return (
            <button
              key={k.id}
              type="button"
              className={`deck-tile key-tile${idleStop ? ' off' : ''}`}
              data-kind={libKeyKind(k.group, k.id, k.action)}
              data-rec={k.id === 'rec-stop' && recording ? 'stop' : undefined}
              aria-label={k.label}
              onKeyDown={onKeyDown(k.action)}
              onClick={(e) => void press(`onair:${k.id}`, e.detail, { command: 'wall2_keys_send_library', args: { id: k.id } }, k.label, k.action, k.where, false)}
              {...tip(text)}
            >
              <I size={22} stroke={1.8} aria-hidden="true" />
              <span className="deck-lbl">{k.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/** The right column: Mark, then the recording keys, then the first-version footnote. Below that stays free. */
export function RightColumn() {
  return (
    <div className="oa-right">
      <span className="k oa-k">Mark</span>
      <MarkTile />
      <RecordingKeys />
      <span className="oa-foot">First version: a timer, a text file and keys. No chat, viewer count or prompter link yet.</span>
    </div>
  );
}
