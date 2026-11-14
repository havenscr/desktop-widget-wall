import { IconAlertTriangle, IconCheck, IconFileText, IconPlayerPlayFilled, IconRefresh } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { tip } from '../ui/HoverTip';
import { clampIndex, clockText, elapsedMs, partTime, READ_FLOOR_MS } from './model';
import { useOnAirStore } from './store';

/** The file's own line at the foot: where the parts come from, lines skipped, Reload and Open file. */
function FileLine() {
  const show = useOnAirStore((s) => s.show);
  const showError = useOnAirStore((s) => s.showError);
  const showNote = useOnAirStore((s) => s.showNote);
  const loadShow = useOnAirStore((s) => s.loadShow);
  const open = useOnAirStore((s) => s.open);
  const [wait, setWait] = useState(false);
  const waitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(waitTimer.current), []);
  const skipped = show?.state === 'ok' ? show.skipped : 0;
  const stale = showError !== null && show !== null;
  const reload = async () => {
    const started = await loadShow();
    if (!started) {
      setWait(true);
      clearTimeout(waitTimer.current);
      waitTimer.current = setTimeout(() => setWait(false), 1500);
    }
  };
  const fromTip = show ? `Read at ${clockText(show.readAt)}. Edit the file, save it, then Reload.` : 'run-of-show.txt in the wall\'s config folder';
  return (
    <div className="oa-file">
      {showNote ? (
        <span className="oa-file-l amber ellipsis" role="status" {...tip(showNote)}>
          <IconAlertTriangle size={18} aria-hidden="true" />
          {showNote}
        </span>
      ) : stale ? (
        <span className="oa-file-l amber ellipsis" {...tip(`${showError}. Showing the read from ${clockText(show.readAt)}.`)}>
          <IconAlertTriangle size={18} aria-hidden="true" />
          {showError}; showing the last read
        </span>
      ) : (
        <span className="oa-file-l ellipsis" {...tip(fromTip)}>
          <IconFileText size={18} aria-hidden="true" />
          From run-of-show.txt
          {skipped > 0 && (
            <span className="oa-skipped" {...tip(`${skipped} line${skipped === 1 ? ' was' : 's were'} not used: before the first ## part, past a limit (40 parts, 12 notes a part) or empty.`)}>
              {` · ${skipped} line${skipped === 1 ? '' : 's'} skipped`}
            </span>
          )}
        </span>
      )}
      <button type="button" className="oa-btn sm" onClick={() => void reload()} {...tip(wait ? `Read again at most every ${READ_FLOOR_MS / 1000} seconds` : 'Read run-of-show.txt again')}>
        <IconRefresh size={16} aria-hidden="true" />
        {wait ? 'Just read' : 'Reload'}
      </button>
      <button type="button" className="oa-btn sm" onClick={() => void open('show')} {...tip('Open run-of-show.txt in the default editor (a starter file is made only when there is none)')}>
        Open file
      </button>
    </div>
  );
}

/** What the run area says when there are no parts to list: no file, a refused file, a failed read, no parts. */
function RunEmpty() {
  const show = useOnAirStore((s) => s.show);
  const showError = useOnAirStore((s) => s.showError);
  const open = useOnAirStore((s) => s.open);
  if (!show && showError) {
    return (
      <div className="oa-empty">
        <span className="oa-empty-t amber">{showError}</span>
        <span className="xs">Check that the wall can reach its config folder, then Reload.</span>
      </div>
    );
  }
  if (!show) {
    return (
      <div className="oa-empty">
        <span className="oa-empty-t">Reading run-of-show.txt</span>
      </div>
    );
  }
  if (show.state === 'missing') {
    return (
      <div className="oa-empty">
        <span className="oa-empty-t">No run-of-show.txt yet</span>
        <span className="xs">Open file makes one with three example parts to edit.</span>
        <button type="button" className="oa-btn cy oa-empty-btn" onClick={() => void open('show')} {...tip('Make run-of-show.txt with three example parts and open it in the default editor')}>
          Open file
        </button>
      </div>
    );
  }
  if (show.state === 'refused') {
    return (
      <div className="oa-empty">
        <span className="oa-empty-t amber ellipsis" {...tip(`${show.reason ?? 'The file was refused'}. Fix it, save it, then Reload.`)}>
          <IconAlertTriangle size={22} aria-hidden="true" />
          {show.reason ?? 'run-of-show.txt was refused'}
        </span>
        <span className="xs">Fix the file, save it, then Reload.</span>
      </div>
    );
  }
  return (
    <div className="oa-empty">
      <span className="oa-empty-t">run-of-show.txt has no parts yet</span>
      <span className="xs">Add a line like ## Welcome | 5 for each part.</span>
    </div>
  );
}

/**
 * The run of show: one row a part, the current one lit, done ones ticked. A click on a row makes
 * that part current. Forty parts scroll inside the list; the current row is kept in view.
 */
export function RunOfShow({ now }: { now: number }) {
  const show = useOnAirStore((s) => s.show);
  const saved = useOnAirStore((s) => s.saved);
  const goPart = useOnAirStore((s) => s.goPart);
  const listRef = useRef<HTMLDivElement | null>(null);
  const parts = show?.state === 'ok' ? show.parts : [];
  const current = clampIndex(saved.partIndex, parts.length);
  const inPart = Math.max(0, elapsedMs(saved, now) - saved.partSinceMs);
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[aria-current="step"]');
    const list = listRef.current;
    if (!row || !list) return;
    if (row.offsetTop < list.scrollTop || row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, row.offsetTop - row.offsetHeight);
  }, [current, parts.length]);
  const title = show?.state === 'ok' ? show.title : null;
  return (
    <div className="oa-runbox">
      <span className="k oa-k ellipsis" {...(title ? tip(title) : {})}>
        Run of show{title ? ` · ${title}` : ''}
      </span>
      {parts.length === 0 ? (
        <RunEmpty />
      ) : (
        <div className="oa-run" ref={listRef} aria-label="Run of show">
          {parts.map((p, i) => {
            const state = i < current ? 'done' : i === current ? 'now' : 'next';
            const t = partTime(p, i === current, inPart);
            return (
              <button
                key={`${i}:${p.name}`}
                type="button"
                className="oa-row"
                data-state={state}
                aria-current={i === current ? 'step' : undefined}
                onClick={() => goPart(i)}
                {...tip(i === current ? `${p.name}: the current part${p.minutes !== null ? `, planned ${p.minutes} min` : ''}` : `Make ${p.name} the current part`)}
              >
                <span className="oa-row-ico">{state === 'done' ? <IconCheck size={20} aria-hidden="true" /> : state === 'now' ? <IconPlayerPlayFilled size={18} aria-hidden="true" /> : null}</span>
                <span className="oa-row-name ellipsis">{p.name}</span>
                <span className="oa-row-t" data-over={t.over ? 'true' : undefined}>
                  {t.text}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <FileLine />
    </div>
  );
}
