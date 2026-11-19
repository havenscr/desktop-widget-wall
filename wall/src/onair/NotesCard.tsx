import { IconArrowLeft, IconArrowRight } from '@tabler/icons-react';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { tip } from '../ui/HoverTip';
import { clampIndex, nextLine } from './model';
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
      <span className="oa-help-l"><code>- A note</code> is a note for the part above it</span>
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
 * The centre card: the current part's notes, as large as they fit, then Previous part, Next part
 * and what comes next. Notes that cannot fit even at the smallest size end in "+N more", whose
 * tooltip carries the rest.
 */
export function NotesCard({ title, right, sizes = NOTE_SIZES, icon, className, style, action }: NotesCardProps = {}) {
  const show = useOnAirStore((s) => s.show);
  const partIndex = useOnAirStore((s) => s.saved.partIndex);
  const goPart = useOnAirStore((s) => s.goPart);
  const parts = show?.state === 'ok' ? show.parts : [];
  const current = clampIndex(partIndex, parts.length);
  const part = parts[current] ?? null;
  const notes = part?.notes ?? [];
  const listRef = useRef<HTMLUListElement | null>(null);
  const [fit, setFit] = useState<NoteFit>({ size: sizes[0], shown: notes.length });
  const key = `${current}\u0000${notes.join('\u0000')}`;
  useLayoutEffect(() => {
    const list = listRef.current;
    const next = list ? fitNotes(list, notes.length, sizes) : { size: sizes[0], shown: notes.length };
    setFit((f) => (f.size === next.size && f.shown === next.shown ? f : next));
    // The notes' text is the key: a new part or a new read measures again.
  }, [key, sizes]);
  const shown = Math.min(fit.shown, notes.length);
  const hidden = notes.slice(shown);
  const prev = current > 0 ? parts[current - 1] : null;
  const next = parts[current + 1] ?? null;
  return (
    <section className={`panel oa-card${className ? ` ${className}` : ''}`} aria-label={title ?? 'Notes for this part'} style={style}>
      {title === undefined ? (
        <span className="k oa-k ellipsis" {...(part ? tip(part.name) : {})}>
          Notes for this part{part ? ` · ${part.name}` : ''}
        </span>
      ) : (
        <div className="oa2-hd">
          {icon}
          <span className="k oa-k ellipsis" {...(part ? tip(part.name) : {})}>
            {title}
            {part ? ` · ${part.name}` : ''}
          </span>
          {right && <span className="oa2-hd-r ellipsis">{right}</span>}
          {action}
        </div>
      )}
      {!part ? (
        <FormatHelp />
      ) : notes.length === 0 ? (
        <div className="oa-nonotes">
          <span className="oa-nonotes-t">No notes for this part</span>
          <span className="xs">Lines under its ## line in run-of-show.txt show here.</span>
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
      <div className="oa-card-foot">
        <button type="button" className="oa-btn fill oa-step" aria-label={title === undefined ? undefined : 'Previous part'} aria-disabled={!prev} onClick={() => prev && goPart(current - 1)} {...tip(prev ? `Back to ${prev.name}` : 'This is the first part')}>
          <IconArrowLeft size={22} aria-hidden="true" />
          {title === undefined ? 'Previous part' : <span className="oa-step-t">Previous part</span>}
        </button>
        <button type="button" className="oa-btn cy oa-step" aria-label={title === undefined ? undefined : 'Next part'} aria-disabled={!next} onClick={() => next && goPart(current + 1)} {...tip(next ? `On to ${next.name}` : 'This is the last part')}>
          {title === undefined ? 'Next part' : <span className="oa-step-t">Next part</span>}
          <IconArrowRight size={22} aria-hidden="true" />
        </button>
        <span className="xs oa-nextline ellipsis" {...tip(nextLine(parts, current))}>
          {nextLine(parts, current)}
        </span>
      </div>
    </section>
  );
}
