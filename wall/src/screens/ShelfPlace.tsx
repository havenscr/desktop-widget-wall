import { IconColorPicker, IconHistory, IconRuler2, IconArrowAutofitHeight, IconRefresh, IconDeviceDesktop, IconFolder, IconGif, IconPinned, IconPlayerStop, IconPointer, IconScan, IconTextRecognition, IconVideo, type Icon } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { TaskCard } from '../tasks/TaskCard';
import type { TasksQuery } from '../tasks/useTasks';
import { useTaskLists } from '../tasks/useTaskLists';
import { loadSettings } from '../settings/settings';
import { CapturesCard } from '../shelf/CapturesCard';
import { RecentCard } from '../shelf/RecentCard';
import { tip } from '../ui/HoverTip';
import { useBrief } from '../work/useBrief';
import { useKeyPress } from '../work/keyPress';
import { Keys } from '../work/Keys';
import { PinnedRow } from '../work/PinnedRow';

/** The ShareX keys the Shelf shows, by library id; each runs through the same press path as a pinned key. */
export const SHELF_KEYS: readonly { id: string; label: string; action: string; Glyph: Icon }[] = [
  { id: 'sx-region', label: 'Region', action: 'sharex:region', Glyph: IconScan },
  { id: 'sx-screen', label: 'Screen', action: 'sharex:screen', Glyph: IconDeviceDesktop },
  { id: 'sx-record-gif', label: 'GIF', action: 'sharex:record-gif', Glyph: IconGif },
  { id: 'sx-record', label: 'Record', action: 'sharex:record', Glyph: IconVideo },
  { id: 'sx-ocr', label: 'Text (OCR)', action: 'sharex:ocr', Glyph: IconTextRecognition },
  { id: 'sx-history', label: 'History', action: 'sharex:history', Glyph: IconHistory },
];

/** Less used ShareX keys, a second smaller block of two rows of four. Only specs the native allowed table already holds (wall2_sharex.rs). */
export const MORE_KEYS: readonly { id: string; label: string; action: string; Glyph: Icon; help: string }[] = [
  { id: 'sx-scrolling', label: 'Scroll', action: 'sharex:scrolling', Glyph: IconArrowAutofitHeight, help: 'ShareX: Scrolling capture' },
  { id: 'sx-color', label: 'Color', action: 'sharex:color', Glyph: IconColorPicker, help: 'ShareX: Color picker' },
  { id: 'sx-last-region', label: 'Last', action: 'sharex:last-region', Glyph: IconRefresh, help: 'ShareX: Capture the last region again' },
  { id: 'sx-ruler', label: 'Ruler', action: 'sharex:ruler', Glyph: IconRuler2, help: 'ShareX: Ruler' },
  { id: 'sx-pin', label: 'Pin', action: 'sharex:pin', Glyph: IconPinned, help: 'ShareX: Pin a box of the screen on top of everything' },
  { id: 'sx-highlighter', label: 'Highlight', action: 'sharex:highlighter', Glyph: IconPointer, help: 'ShareX: Ring the mouse pointer, for demos' },
  { id: 'sx-folder', label: 'Folder', action: 'sharex:folder', Glyph: IconFolder, help: 'ShareX: Open the screenshots folder' },
  { id: 'sx-stop-record', label: 'Stop rec', action: 'sharex:stop-record', Glyph: IconPlayerStop, help: 'ShareX: Stop the screen recording and save it' },
];

/** The picked list is remembered per viewer. */
export const LIST_KEY = 'wall2-shelf-list';

function readPicked(names: readonly string[]): string | null {
  try {
    const v = localStorage.getItem(LIST_KEY);
    if (v && names.includes(v)) return v;
  } catch {
    /* storage can be blocked */
  }
  return names[0] ?? null;
}

const NO_TIDY = (): void => undefined;

/**
 * The Shelf place (concept 3A): captures on the left (the ShareX history, `shelf/CapturesCard.tsx`), the ShareX keys and the task app's lists in
 * the middle, and the picked list in the task column with the Always here deck under it. The left wing keeps the clock and, under it, the Recent files card (`shelf/RecentCard.tsx`).
 * List names come from the task app (`wall2_tasks_lists`); a non-empty `shelfLists` setting overrides them.
 */
export function ShelfPlace() {
  const override = loadSettings().shelfLists;
  const lists = useTaskLists(override.length === 0);
  const names = override.length > 0 ? override : lists.status === 'ready' ? lists.names : [];
  const [choice, setPicked] = useState<string | null>(null);
  // The remembered pick wins when it is still a list; otherwise the first list is picked.
  const picked = choice !== null && names.includes(choice) ? choice : readPicked(names);
  const [brief, show] = useBrief();
  const { press } = useKeyPress(show, NO_TIDY);
  useEffect(() => {
    if (picked === null) return;
    try {
      localStorage.setItem(LIST_KEY, picked);
    } catch {
      /* storage can be blocked */
    }
  }, [picked]);
  const query: TasksQuery | null = picked ? { list: picked } : null;
  return (
    <section className="work shelf-place zones" data-place="shelf" aria-label="Shelf">
      <div className="wing shelf-left">
        <RecentCard />
      </div>
      <div className="shelf-centre">
        <CapturesCard />
        <section className="shelf-card shelf-side" aria-label="Capture keys">
          <div className="k">
            Capture <span className="shelf-sub">ShareX keys</span>
          </div>
          <div className="shelf-keys">
            {SHELF_KEYS.map(({ id, label, action, Glyph }) => (
              <button
                key={id}
                type="button"
                className="shelf-key"
                onClick={(e) => {
                  // A key press from the keyboard never fires a ShareX task (the same rule as every capture key).
                  if (e.detail === 0) return;
                  void press(id, e.detail, { command: 'wall2_keys_send_library', args: { id } }, label, action, { name: 'ShareX', general: true }, false);
                }}
                {...tip(`ShareX: ${label}`)}
              >
                <Glyph size={26} stroke={1.8} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <p className="shelf-brief" role="status">
            {brief ?? ''}
          </p>
          <div className="k">
            More ShareX <span className="shelf-sub">less used</span>
          </div>
          <div className="shelf-keys shelf-more" role="group" aria-label="More ShareX keys">
            {MORE_KEYS.map(({ id, label, action, Glyph, help }) => (
              <button
                key={id}
                type="button"
                className="shelf-key shelf-key-sm"
                onClick={(e) => {
                  if (e.detail === 0) return;
                  void press(id, e.detail, { command: 'wall2_keys_send_library', args: { id } }, label, action, { name: 'ShareX', general: true }, false);
                }}
                {...tip(help)}
              >
                <Glyph size={22} stroke={1.8} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </section>
      </div>
      <div className="wing wr right-wing">
        {query && picked ? <TaskCard key={picked} query={query} title={picked} lists={{ names, onPick: setPicked }} /> : <section className="tasks" aria-label="Tasks"><div className="row sb tasks-hd"><span className="k">Tasks</span></div><div className="tasks-body"><div className="s">{override.length > 0 || lists.status === 'ready' ? 'No lists in the task app' : lists.status === 'error' ? 'Lists unavailable' : 'Loading lists'}</div></div></section>}
        <div className="deck">
          <PinnedRow />
          <Keys />
        </div>
      </div>
    </section>
  );
}
