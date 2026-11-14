import { IconBookmark, IconFileText, IconKeyboard, type Icon } from '@tabler/icons-react';
import { RECORDING_KEYS, recordingKeyTip } from '../signals/recordingKeys';
import { useSignalStore } from '../signals/store';
import { tip } from '../ui/HoverTip';
import { KeyIcon } from '../work/keyIcons';
import { libKeyKind } from '../work/keyKind';
import { useLibGroups } from '../work/keyLibrary';
import { keyboardOnMouseKey, useKeyPress } from '../work/keyPress';
import { allKeys, type LibGroup } from '../work/libraryModel';
import { useBrief } from '../work/useBrief';
import { markLine } from './model';
import { useOnAirStore } from './store';

/** Mark a moment: one line in marks.txt with the show time and the part; today's count and last times under it. */
function MarkTile() {
  const marks = useOnAirStore((s) => s.marks);
  const note = useOnAirStore((s) => s.marksNote);
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

/** The four keys the picture draws, in order: the key library's Record 16:9, Stop, Snip and Hide screen, by id. */
export const ONAIR_KEY_IDS = ['record-169', 'rec-stop', 'snip', 'strip-dark'] as const;

/** A key as On Air draws it, everything taken from the key library (and, for the recorder's keys, the recording mode's shared definitions). */
export interface ResolvedKey {
  id: string;
  label: string;
  /** The library group, for the colour (keyKind.ts). */
  group: string;
  /** The wall action the key runs, or null for a key Rust sends. */
  action: string | null;
  /** The library's icon name, drawn as the deck draws it; a recording key brings its own. */
  icon: string;
  recordingIcon: Icon | null;
  where: { name: string; general: boolean };
  tip: string;
}

/** The key with this id from the library, or null when the library has none (or one that cannot run). */
export function resolveKey(id: string, lib: readonly LibGroup[]): ResolvedKey | null {
  const hit = allKeys(lib).get(id);
  if (!hit || !hit.key.runnable || hit.key.kind === 'soon') return null;
  const { key, group } = hit;
  const rk = RECORDING_KEYS.find((r) => r.id === id);
  // The recorder's own keys say where they go the way recording mode says it; any other key goes
  // to the program of its group, or the app in front when its group is for any program.
  const where = rk ? { name: rk.to, general: rk.to === 'the app in front' } : { name: group.exes.length > 0 ? group.title : 'the app in front', general: group.exes.length === 0 };
  const text = rk ? recordingKeyTip(rk, key.how) : `${key.label}${group.exes.length > 0 ? ` (${group.title})` : ''}${key.kind === 'check' ? ', a shortcut to check on your PC' : ''}. ${key.how}.`;
  return { id, label: key.label, group: group.id, action: key.action, icon: key.icon, recordingIcon: rk?.icon ?? null, where, tip: text };
}

/** The recording keys, from the key deck: its library, its colours, its press path. */
function RecordingKeys() {
  const recording = useSignalStore((s) => s.recording);
  const known = useSignalStore((s) => s.known);
  const { groups, failed } = useLibGroups();
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
      {groups === null ? (
        <div className="s deck-quiet oa-keys-quiet" {...tip(failed ? 'The key library could not be read. Reopen On Air to try again, or restart the wall if this stays.' : 'Reading the key library')}>
          {failed ? 'Keys not available' : 'Loading keys'}
        </div>
      ) : (
        <div className="deck-tiles keys-tiles oa-keys">
          {ONAIR_KEY_IDS.map((id) => {
            const k = resolveKey(id, groups);
            if (!k) {
              const why = `The key library has no runnable key "${id}"`;
              return (
                <button key={id} type="button" className="deck-tile key-tile off" aria-label={id} aria-disabled="true" onClick={() => showBrief(why)} {...tip(why)}>
                  <IconKeyboard size={22} stroke={1.8} aria-hidden="true" />
                  <span className="deck-lbl">{id}</span>
                </button>
              );
            }
            // Stop agrees with recording mode: lit red while a recorder runs, plain and saying so when none does.
            const idleStop = k.id === 'rec-stop' && known && !recording;
            const text = k.id === 'rec-stop' ? (recording ? 'Stop the recording that is running now' : idleStop ? 'No recording is running; Stop is sent to the recorder only while one runs' : k.tip) : k.tip;
            const I = k.recordingIcon;
            return (
              <button
                key={k.id}
                type="button"
                className={`deck-tile key-tile${idleStop ? ' off' : ''}`}
                data-kind={libKeyKind(k.group, k.id, k.action)}
                data-rec={k.id === 'rec-stop' && recording ? 'stop' : undefined}
                aria-label={k.label}
                onKeyDown={onKeyDown(k.action)}
                onClick={(e) => {
                  if (keyboardOnMouseKey(k.action, e.detail)) return;
                  void press(`onair:${k.id}`, e.detail, { command: 'wall2_keys_send_library', args: { id: k.id } }, k.label, k.action, k.where, false);
                }}
                {...tip(text)}
              >
                {I ? <I size={22} stroke={1.8} aria-hidden="true" /> : <KeyIcon name={k.icon} size={22} />}
                <span className="deck-lbl">{k.label}</span>
              </button>
            );
          })}
        </div>
      )}
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
