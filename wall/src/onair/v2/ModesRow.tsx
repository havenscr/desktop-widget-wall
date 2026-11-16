import { useRef, type KeyboardEvent } from 'react';
import { tip } from '../../ui/HoverTip';
import { MODE_LABEL, type ModePick, type PageMode } from '../modes';

const ORDER: readonly PageMode[] = ['live', 'rec', 'meet'];

/**
 * The mode switch at the top left: three segments (the current page lit, a dot on every case the wall
 * sees on now), Auto, and the reason in one line. A segment click holds that page; Auto lets the wall
 * choose again.
 */
export function ModesRow({ pick, held, why, onHold, onAuto }: { pick: ModePick; held: PageMode | null; why: string; onHold: (m: PageMode) => void; onAuto: () => void }) {
  const group = useRef<HTMLDivElement | null>(null);
  const auto = held === null;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    const radios = [...(group.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
    const at = radios.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    radios[(at + dir + radios.length) % radios.length]?.focus();
  };
  return (
    <div className="oa2-b oa2-modes">
      <div className="oa2-seg" role="radiogroup" aria-label="On Air mode" ref={group} onKeyDown={onKeyDown}>
        {ORDER.map((id) => {
          const seen = pick.seen.includes(id);
          const lit = pick.mode === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              className="oa2-segb"
              aria-checked={lit}
              aria-label={`${MODE_LABEL[id]}${seen ? ', on now' : ''}`}
              onClick={() => {
                // The lit page of a hold does nothing; any other click holds that page.
                if (held === id) return;
                onHold(id);
              }}
              {...tip(lit && !auto ? `${MODE_LABEL[id]} is held. Click Auto to let the wall choose.` : `Show the ${MODE_LABEL[id]} page and hold it until you click Auto`)}
            >
              {seen && <i className="oa2-dot" data-mode={id} aria-hidden="true" />}
              {MODE_LABEL[id]}
            </button>
          );
        })}
      </div>
      <button type="button" className="oa2-auto" aria-pressed={auto} onClick={() => !auto && onAuto()} {...tip(auto ? 'Auto: the wall picks the page from what is on now' : 'Click to let the wall pick the page again')}>
        <i className={`st-sw${auto ? ' on' : ''}`} aria-hidden="true">
          <i />
        </i>
        Auto
      </button>
      <span className="oa2-why" role="status" {...tip(why)}>
        {why}
      </span>
    </div>
  );
}
