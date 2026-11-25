import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { IconArrowsSort, IconCheck } from '@tabler/icons-react';
import { tip } from '../../ui/HoverTip';
import { SORTS, type ListSort } from './listView';

/**
 * The sort chip of the Watch list's chip row: an icon and the short name of the order. It opens a listbox under it
 * (Enter or Space opens it, the arrows move, Enter or Space picks, Escape and a press anywhere else close it, Escape
 * hands the focus back). Sorting only reorders the saved list; nothing is asked of YouTube.
 */
export function SortChip({ value, onPick }: { value: ListSort; onPick: (sort: ListSort) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const current = SORTS.find((s) => s.id === value) ?? SORTS[0]!;

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
  const pick = (sort: ListSort) => {
    close(true);
    if (sort !== value) onPick(sort);
  };

  return (
    <div ref={wrap} className="w-sortwrap">
      <button
        ref={button}
        type="button"
        className={`w-sortchip${value !== 'recent' ? ' on' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Sort: ${current.label}, change the order`}
        onClick={() => setOpen((o) => !o)}
        {...tip('Change the order of the list')}
      >
        <IconArrowsSort size={18} stroke={1.8} aria-hidden="true" />
        <span>{current.short}</span>
      </button>
      {open ? (
        <div ref={menu} className="mu-sortmenu w-sortmenu" role="listbox" aria-label="Sort the list" onKeyDown={onKeyDown}>
          {SORTS.map((s) => (
            <button key={s.id} type="button" role="option" aria-selected={s.id === value} tabIndex={-1} className={s.id === value ? 'hot' : undefined} onClick={() => pick(s.id)}>
              <span>{s.label}</span>
              {s.id === value ? <IconCheck size={18} stroke={2} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
