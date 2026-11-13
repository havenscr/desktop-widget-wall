import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke } from '../bridge/tauri';
import { tip } from '../ui/HoverTip';
import { useVisible } from '../ui/useVisible';
import { arrangeReason, errorText, isAbsent, UNDO_SHOW_MS, windowsText } from './deckModel';
import { useBrief } from './useBrief';

type Layout = 'thirds' | 'focus' | 'record';
/** How often the row checks that a big screen is still there. */
const STATUS_MS = 60_000;

/** Small diagrams of the three layouts, drawn as the concept does: outlines, one fill. */
function Diagram({ layout }: { layout: Layout }) {
  return (
    <svg className="bs-ic" viewBox="0 0 76 22" width="76" height="22" aria-hidden="true">
      <rect x="1" y="1" width="74" height="20" rx="3" className="bs-frame" />
      {layout === 'thirds' && (
        <>
          <path d="M25.7 1v20M50.3 1v20" className="bs-frame" />
          <rect x="3" y="3" width="21" height="16" rx="1.5" className="bs-fill" />
        </>
      )}
      {layout === 'focus' && <rect x="14" y="3" width="48" height="16" rx="1.5" className="bs-fill" />}
      {layout === 'record' && (
        <>
          <rect x="24" y="3" width="28" height="16" rx="1.5" className="bs-fill" />
          <circle cx="48" cy="6.5" r="1.7" className="bs-rec" />
        </>
      )}
    </svg>
  );
}

const LAYOUTS: { id: Layout; label: string; tip: ReactNode }[] = [
  { id: 'thirds', label: 'Thirds', tip: 'Put the three newest windows on the big screen side by side in equal columns (two share it in halves, one takes it all)' },
  { id: 'focus', label: 'Focus', tip: 'Put the newest window in a centred column two thirds wide and leave the others where they are' },
  { id: 'record', label: 'Record 16:9', tip: 'Size the newest window to the largest 16:9 frame that fits the big screen, centred, for recording a 16:9 video' },
];

/**
 * The Big screen row under Next three: three layout buttons for the owner's widest
 * monitor. A layout runs on a click only; Undo shows for a minute afterwards. Not drawn
 * where the commands do not exist; the buttons are disabled (with a tooltip) when the
 * wall's own monitor is the only one.
 */
export function BigScreen() {
  const visible = useVisible();
  const [available, setAvailable] = useState<boolean | 'absent' | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [undoUntil, setUndoUntil] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [brief, showBrief] = useBrief();

  useEffect(() => {
    if (!visible) return;
    let live = true;
    const read = () =>
      invoke<boolean>('wall2_arrange_status').then(
        (ok) => live && setAvailable(ok === true),
        (e) => live && setAvailable(isAbsent(e) ? 'absent' : false),
      );
    void read();
    const id = setInterval(read, STATUS_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [visible]);

  // Hide Undo when its minute is up.
  useEffect(() => {
    if (undoUntil <= clock) return;
    const id = setTimeout(() => setClock(Date.now()), undoUntil - clock + 20);
    return () => clearTimeout(id);
  }, [undoUntil, clock]);

  const run = useCallback(
    async (command: string, args: Record<string, unknown> | undefined, done: (n: number) => string, after?: (n: number) => void) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const n = await invoke<number>(command, args);
        showBrief(done(typeof n === 'number' ? n : 0));
        after?.(n);
      } catch (e) {
        showBrief(arrangeReason(errorText(e)));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [showBrief],
  );

  if (available === null || available === 'absent') return null;
  const off = available === false;
  const undoShown = undoUntil > clock;
  const offTip = 'There is no big screen: the wall is the only monitor';

  return (
    <section className="bigscreen deck-row" aria-label="Big screen">
      <div className="row sb deck-hd">
        <span className="k">Big screen</span>
        <span className="deck-hd-r">
          {brief && (
            <span className="xs deck-brief" role="status">
              {brief}
            </span>
          )}
          {undoShown && (
            <button
              type="button"
              className="deck-mini"
              disabled={busy}
              {...tip('Put the windows the last layout moved back where they were (for one minute)')}
              onClick={() =>
                void run('wall2_arrange_undo', undefined, (n) => windowsText(n, 'put back'), () => setUndoUntil(0))
              }
            >
              Undo
            </button>
          )}
        </span>
      </div>
      <div className="deck-tiles bs-tiles" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {LAYOUTS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`deck-tile bs-tile${off ? ' off' : ''}`}
            disabled={busy}
            aria-disabled={off || undefined}
            aria-label={l.label}
            {...tip(off ? offTip : l.tip)}
            onClick={() =>
              !off &&
              void run('wall2_arrange', { layout: l.id }, (n) => windowsText(n, 'arranged'), () => {
                setClock(Date.now());
                setUndoUntil(Date.now() + UNDO_SHOW_MS);
              })
            }
          >
            <Diagram layout={l.id} />
            <span className="deck-lbl">{l.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
