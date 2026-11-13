import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { invoke } from '../bridge/tauri';
import { tip } from '../ui/HoverTip';
import { useVisible } from '../ui/useVisible';
import { arrangedText, arrangeReason, errorText, isAbsent, UNDO_SHOW_MS, windowsText, type ArrangeResult } from './deckModel';
import { useGuard } from './useGuard';
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
  { id: 'thirds', label: 'Thirds', tip: 'Put the three newest windows on the big screen side by side in equal columns (two share it in halves, one takes the centred third)' },
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
  const guard = useGuard();
  const [applied, setApplied] = useState<Layout | null>(null);
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
    (id: string, detail: number, command: string, args: Record<string, unknown> | undefined, done: (answer: unknown) => string, after?: () => void) =>
      guard.run(id, detail, async () => {
        setBusy(true);
        try {
          const answer = await invoke<unknown>(command, args);
          showBrief(done(answer));
          after?.();
        } catch (e) {
          showBrief(arrangeReason(errorText(e)));
        } finally {
          setBusy(false);
        }
      }),
    [guard, showBrief],
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
              onKeyDown={guard.onKeyDown}
              onClick={(e) =>
                void run('undo', e.detail, 'wall2_arrange_undo', undefined, (n) => windowsText(typeof n === 'number' ? n : 0, 'put back'), () => {
                  setUndoUntil(0);
                  setApplied(null);
                })
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
            className={`deck-tile bs-tile${off ? ' off' : ''}${undoShown && applied === l.id ? ' sel' : ''}`}
            disabled={busy}
            aria-disabled={off || undefined}
            aria-label={l.label}
            {...tip(off ? offTip : l.tip)}
            onKeyDown={guard.onKeyDown}
            onClick={(e) =>
              !off &&
              void run(l.id, e.detail, 'wall2_arrange', { layout: l.id }, (r) => arrangedText(r as ArrangeResult), () => {
                setClock(Date.now());
                setUndoUntil(Date.now() + UNDO_SHOW_MS);
                setApplied(l.id);
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
