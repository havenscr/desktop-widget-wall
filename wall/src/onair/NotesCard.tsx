import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { tip } from '../ui/HoverTip';
import { ShowProblem, useShowProblem } from './ShowProblem';
import { useOnAirStore } from './store';

/** Note sizes tried in turn, largest first, until every note fits. */
export const NOTE_SIZES = [36, 30, 26, 22] as const;

/** The fit found for a list of notes: the size and how many show before "+N more". */
export interface NoteFit {
  size: number;
  shown: number;
}

/**
 * Finds the largest size at which every note fits the list, else at the smallest size the most
 * notes that fit with a "+N more" line under them. Measures by changing the list in place and
 * puts it back as it was before returning (React keeps owning it; the "+N more" line is one line
 * whatever its number, so its text is not changed while measuring).
 */
export function fitNotes(list: HTMLElement, count: number, sizes: readonly number[] = NOTE_SIZES): NoteFit {
  const items = [...list.querySelectorAll<HTMLElement>(':scope > .oa-note')];
  const more = list.querySelector<HTMLElement>(':scope > .oa-more');
  const before = { size: list.style.getPropertyValue('--oa-note'), hidden: items.map((i) => i.hidden), more: more?.hidden ?? true };
  const fits = () => list.scrollHeight <= list.clientHeight + 0.5;
  let result: NoteFit = { size: sizes[sizes.length - 1], shown: count };
  try {
    items.forEach((i) => (i.hidden = false));
    if (more) more.hidden = true;
    let found = false;
    for (const size of sizes) {
      list.style.setProperty('--oa-note', `${size}px`);
      if (fits()) {
        result = { size, shown: count };
        found = true;
        break;
      }
    }
    if (!found && more) {
      more.hidden = false;
      let shown = count;
      while (shown > 1 && !fits()) {
        shown -= 1;
        items[shown].hidden = true;
      }
      result = { size: sizes[sizes.length - 1], shown };
    }
  } finally {
    list.style.setProperty('--oa-note', before.size);
    items.forEach((i, k) => (i.hidden = before.hidden[k]));
    if (more) more.hidden = before.more;
  }
  return result;
}

/** How the file works, in three lines, for when there is nothing to show. */
function FormatHelp() {
  return (
    <div className="oa-help">
      <span className="oa-help-l"><code>## Part name | 10</code> starts a part planned for 10 minutes</span>
      <span className="oa-help-l"><code>- A note</code> is one note on the list</span>
      <span className="oa-help-l"><code>// A comment</code> is ignored; <code># Title</code> on the first line names the show</span>
    </div>
  );
}

/** What the new On Air frame changes about the card: its heading, the text at the right of it, the sizes tried, an icon in front of the heading, and a class for its box. */
export interface NotesCardProps {
  title?: string;
  right?: string;
  sizes?: readonly number[];
  icon?: ReactNode;
  className?: string;
  /** A box's own position and width, and a control at the end of the heading. */
  style?: CSSProperties;
  action?: ReactNode;
}

/**
 * The centre card: every note in the run of show as one list in file order, as large as they fit.
 * Notes that cannot fit even at the smallest size end in "+N more", whose tooltip carries the rest.
 */
export function NotesCard({ title, right, sizes = NOTE_SIZES, icon, className, style, action }: NotesCardProps = {}) {
  const show = useOnAirStore((s) => s.show);
  const parts = show?.state === 'ok' ? show.parts : [];
  const problem = useShowProblem();
  const hasShow = parts.length > 0;
  const notes = parts.flatMap((p) => p.notes);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [fit, setFit] = useState<NoteFit>({ size: sizes[0], shown: notes.length });
  const key = notes.join('\u0000');
  useLayoutEffect(() => {
    const list = listRef.current;
    const next = list ? fitNotes(list, notes.length, sizes) : { size: sizes[0], shown: notes.length };
    setFit((f) => (f.size === next.size && f.shown === next.shown ? f : next));
    // The notes' text is the key: a new read measures again.
  }, [key, sizes]);
  const shown = Math.min(fit.shown, notes.length);
  const hidden = notes.slice(shown);
  return (
    <section className={`panel oa-card${className ? ` ${className}` : ''}`} aria-label={title ?? 'Notes'} style={style}>
      {title === undefined ? (
        <span className="k oa-k ellipsis">Notes</span>
      ) : (
        <div className="oa2-hd">
          {icon}
          <span className="k oa-k ellipsis">{title}</span>
          {right && <span className="oa2-hd-r ellipsis">{right}</span>}
          {action}
        </div>
      )}
      {!hasShow ? (
        <>
          {problem && <ShowProblem text={problem} />}
          <FormatHelp />
        </>
      ) : notes.length === 0 ? (
        <div className="oa-nonotes">
          <span className="oa-nonotes-t">No notes yet</span>
          <span className="xs">Lines in run-of-show.txt show here.</span>
        </div>
      ) : (
        <ul className="oa-notes" ref={listRef} style={{ ['--oa-note' as string]: `${fit.size}px` }}>
          {notes.map((n, i) => (
            <li key={i} className="oa-note" hidden={i >= shown}>
              <i className="oa-dot" aria-hidden="true" />
              <span>{n}</span>
            </li>
          ))}
          <li className="oa-more" hidden={hidden.length === 0} {...tip(hidden.join('\n'))}>
            {hidden.length > 0 ? `+${hidden.length} more` : ''}
          </li>
        </ul>
      )}
    </section>
  );
}
