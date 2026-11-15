import { IconBookmark, IconFileText } from '@tabler/icons-react';
import { useState } from 'react';
import { invoke } from '../bridge/tauri';
import { useSignalStore } from '../signals/store';
import { tip } from '../ui/HoverTip';
import { marksLine } from './islandModel';
import { useMeetStore } from './meetStore';

/** The most characters of a meeting title that go to marks.txt as the part. */
export const MARK_PART_MAX = 60;
/** Marks closer together than this count once. */
export const MARK_QUIET_MS = 1000;

/** The part name of a mark: the meeting title cut to 60 characters, or null with none. */
export function markPart(title: string | undefined): string | null {
  const t = (title ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const chars = [...t];
  return chars.length > MARK_PART_MAX ? chars.slice(0, MARK_PART_MAX).join('').trim() : t;
}

/** One fixed line for a failed mark, never the native text. */
export function markErrorText(e: unknown): string {
  const t = e instanceof Error ? e.message : String(e);
  if (t === 'refused') return 'marks.txt is full or the mark was refused';
  if (t === 'not-configured') return 'No config folder on this PC';
  return 'Could not write marks.txt';
}

/**
 * Lower right: Mark a moment (one tile, in the key deck's key style, tinted magenta) and Open file. A click writes the
 * time into the call and the meeting title to marks.txt; before a call the tile is dashed, dim and does nothing.
 */
export function Capture({ title }: { title: string | undefined }) {
  const call = useSignalStore((s) => s.call);
  const marks = useMeetStore((s) => s.marks);
  const addMark = useMeetStore((s) => s.addMark);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = call !== null;
  const line = note ?? (marks.length > 0 ? marksLine(marks) : 'Marks the time in the call to marks.txt');

  const mark = async () => {
    if (!call || busy) return;
    const now = Date.now();
    const last = marks[marks.length - 1];
    if (last && now - last.at < MARK_QUIET_MS) return;
    setBusy(true);
    const showMs = Math.max(0, Math.floor(now - call.since));
    try {
      await invoke('wall2_onair_mark', { showMs, part: markPart(title) });
      addMark({ at: now, showMs });
      setNote(null);
    } catch (e) {
      setNote(markErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="meet-capture" aria-label="Capture">
      <div className="row sb meet-cap-hd">
        <span className="k meet-k">Capture</span>
        <span className="meet-xxs">{live ? 'This call' : 'Nothing running'}</span>
      </div>
      <div className={live ? 'meet-cap-row' : 'meet-cap-row off'}>
        <button
          type="button"
          className="meet-cap"
          aria-disabled={live ? undefined : 'true'}
          aria-busy={busy}
          onClick={(e) => {
            // One mark for a double click: the second click of a pair never counts.
            if (e.detail > 1) return;
            void mark();
          }}
          {...tip(live ? 'Write the time in this call and the meeting title to marks.txt, for finding the moment later. A second click within a second counts once.' : 'Wakes when the call starts')}
        >
          <span className="meet-cap-ico" aria-hidden="true">
            <IconBookmark size={30} stroke={1.8} />
          </span>
          <span className="meet-cap-tx">
            <span className="meet-cap-t">Mark a moment</span>
            <span className={`meet-cap-s ellipsis${note ? ' amber' : ''}`} role="status">
              {line}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="meet-cap-open"
          onClick={() => void invoke('wall2_onair_open', { which: 'marks' }).catch(() => setNote('Could not open marks.txt'))}
          {...tip('Open marks.txt in the default editor: one line a mark, with the local time, the time in the call and the meeting title')}
        >
          <IconFileText size={20} aria-hidden="true" />
          Open file
        </button>
      </div>
    </div>
  );
}
