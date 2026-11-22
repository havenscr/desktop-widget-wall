import { IconCheck, IconChevronDown } from '@tabler/icons-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { tip } from '../ui/HoverTip';

/** A pick remounts the card under the heading (it is keyed by list), so the new button takes focus back when it mounts. */
let refocusOnMount = false;

/**
 * The list name in a task heading as a button that opens a menu of the task app's lists under it.
 * Enter or Space opens it, the arrows move, Enter or Space picks, Escape and a press anywhere else close it
 * (Escape hands focus back to the button).
 */
export function ListPicker({ current, names, onPick }: { current: string; names: readonly string[]; onPick: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!refocusOnMount) return;
    refocusOnMount = false;
    button.current?.focus();
  }, []);

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
      if (rows.length) rows[(at + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length].focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      rows[event.key === 'Home' ? 0 : rows.length - 1]?.focus();
    }
  };
  const pick = (name: string) => {
    close(true);
    if (name !== current) {
      refocusOnMount = true;
      onPick(name);
    }
  };

  return (
    <div ref={wrap} className="lp">
      <button
        ref={button}
        type="button"
        className="lp-btn k"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`List: ${current}`}
        onClick={() => setOpen((o) => !o)}
        {...tip('Pick which task list to show here')}
      >
        <span className="lp-name">{current}</span>
        <IconChevronDown size={20} stroke={2} aria-hidden="true" />
      </button>
      {open && (
        <div ref={menu} className="lp-menu" role="listbox" aria-label="Task lists" onKeyDown={onKeyDown}>
          {names.map((n) => (
            <button key={n} type="button" role="option" aria-selected={n === current} tabIndex={-1} onClick={() => pick(n)}>
              <span>{n}</span>
              {n === current && <IconCheck size={22} stroke={2.2} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
