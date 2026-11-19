import { IconCamera, IconHistory, IconDeviceDesktop, IconGif, IconScan, IconTextRecognition, IconVideo, type Icon } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { TaskCard } from '../tasks/TaskCard';
import type { TasksQuery } from '../tasks/useTasks';
import { loadSettings } from '../settings/settings';
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
 * The Shelf place (concept 3A): captures on the left (their history arrives with the ShareX
 * history read; until then the panel says so), the ShareX keys and the task app's lists in
 * the middle, and the picked list in the task column with the Always here deck under it.
 * List names come from the `shelfLists` setting: the wall has no route that lists them.
 */
export function ShelfPlace() {
  const names = loadSettings().shelfLists;
  const [picked, setPicked] = useState<string | null>(() => readPicked(names));
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
      <div className="wing" />
      <div className="shelf-centre">
        <section className="shelf-card shelf-captures" aria-label="Captures">
          <div className="k">
            <IconCamera size={22} stroke={1.8} aria-hidden="true" /> Captures <span className="shelf-sub">ShareX, newest first</span>
          </div>
          <p className="shelf-note">Your ShareX history shows here soon. The keys beside it work now.</p>
        </section>
        <section className="shelf-card shelf-side" aria-label="Capture keys and lists">
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
            Lists <span className="shelf-sub">your task app</span>
          </div>
          {names.length === 0 ? (
            <p className="shelf-note">Add list names as shelfLists in the wall settings and they show here.</p>
          ) : (
            <div className="shelf-lists" role="group" aria-label="Task lists">
              {names.map((n) => (
                <button key={n} type="button" className={`chip shelf-list${n === picked ? ' on' : ''}`} aria-pressed={n === picked} onClick={() => setPicked(n)}>
                  {n}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
      <div className="wing wr right-wing">
        {query && picked ? <TaskCard key={picked} query={query} title={picked} /> : <section className="tasks" aria-label="Tasks"><div className="row sb tasks-hd"><span className="k">Tasks</span></div><div className="tasks-body"><div className="s">Pick a list</div></div></section>}
        <div className="deck">
          <PinnedRow />
          <Keys />
        </div>
      </div>
    </section>
  );
}
