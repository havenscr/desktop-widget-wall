import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { IconArrowsSort, IconCheck, IconChevronDown, IconEye, IconSortAscendingLetters, IconSortAscendingNumbers, IconSortDescendingNumbers, IconSparkles, IconUser } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { tip } from '../../ui/HoverTip';
import { DEFAULT_SORT, SORT_CHOICES, SORT_TIP, type YtSort } from './model';

const ICONS: Record<YtSort, ReactNode> = {
  best: <IconSparkles size={18} stroke={1.8} aria-hidden="true" />,
  views: <IconEye size={18} stroke={1.8} aria-hidden="true" />,
  longest: <IconSortDescendingNumbers size={18} stroke={1.8} aria-hidden="true" />,
  shortest: <IconSortAscendingNumbers size={18} stroke={1.8} aria-hidden="true" />,
  channel: <IconUser size={18} stroke={1.8} aria-hidden="true" />,
  title: <IconSortAscendingLetters size={18} stroke={1.8} aria-hidden="true" />,
};

/**
 * The sort button of a search's chip row. At rest it is an icon; once a sort other than Best match is picked it shows
 * that sort's short name and turns cyan. It opens a short menu under it (a listbox): Enter or Space opens it, the arrows
 * move, Enter or Space picks, Escape and a press anywhere else close it (Escape hands the focus back to the button).
 * Sorting reorders the results already loaded; nothing here asks YouTube for anything.
 */
export function YtSortButton({ value, onPick, labelled = false }: { value: YtSort; onPick: (sort: YtSort) => void; /** Watch's results: the button always reads "Sort: <short name>" with a chevron, and its menu opens under the whole header row. */ labelled?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const picked = value !== DEFAULT_SORT;
  const current = SORT_CHOICES.find((c) => c.id === value) ?? SORT_CHOICES[0]!;

  useEffect(() => {
    if (!open) return;
    const el = menu.current;
    (el?.querySelector<HTMLElement>('[aria-selected="true"]') ?? el?.querySelector<HTMLElement>('[role="option"]'))?.focus();
    const away = (event: Event) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);

  const close = (restore: boolean) => {
    setOpen(false);
    if (restore) button.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const rows = [...(menu.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (rows.length) rows[(at + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]!.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      rows[event.key === 'Home' ? 0 : rows.length - 1]?.focus();
    }
  };
  const pick = (sort: YtSort) => {
    close(true);
    if (sort !== value) onPick(sort);
  };

  return (
    <div ref={wrap} className={`mu-sortwrap${labelled ? ' labelled' : ''}`}>
      <button
        ref={button}
        type="button"
        className={`mu-sort${picked && !labelled ? ' on' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Sort results: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
        {...tip(SORT_TIP)}
      >
        {labelled ? null : <IconArrowsSort size={18} stroke={1.8} aria-hidden="true" />}
        {labelled ? <span className="mu-sort-name">Sort: {current.short}</span> : picked ? <span className="mu-sort-name">{current.short}</span> : null}
        {labelled ? <IconChevronDown size={18} stroke={2} aria-hidden="true" /> : null}
      </button>
      {open && (
        <div ref={menu} className={`mu-sortmenu${labelled ? ' ws-menu' : ''}`} role="listbox" aria-label="Sort results" onKeyDown={onKeyDown}>
          {SORT_CHOICES.map((c) => (
            <button key={c.id} type="button" role="option" aria-selected={c.id === value} tabIndex={-1} className={c.id === value ? 'hot' : undefined} onClick={() => pick(c.id)}>
              {ICONS[c.id]}
              <span>{c.label}</span>
              {c.id === value ? <IconCheck size={18} stroke={2} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
