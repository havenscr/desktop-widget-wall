import { IconCheck } from '@tabler/icons-react';
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react';
import { overlayOwnsPointer } from '../ribbon/DrawerScrim';

export interface CapMenuItem {
  id: string;
  label: string;
  Icon?: ComponentType<{ size?: number; stroke?: number; 'aria-hidden'?: boolean }>;
  /** A tick drawn at the end of the row (the current choice of a filter). */
  ticked?: boolean;
  disabled?: boolean;
  /** One plain sentence on what the row does, shown on hover and read out by a screen reader. */
  help?: string;
  /** A line drawn above this row. */
  rule?: boolean;
  /** A first click only arms the row: it shows this text for `ARM_MS`, and a second click inside that time chooses it. */
  confirm?: string;
}

/** How long an armed row waits for its second click. */
export const ARM_MS = 3_000;

/**
 * A small menu in the card, styled like the keys menu (`.key-menu`) with the same keyboard handling: it
 * opens on its first row, Up and Down move, Escape closes and puts focus back where it was, and a press
 * anywhere else closes it. `x` and `y` are the top left corner in the card's own pixels.
 */
export function CapMenu({ label, items, x, y, width, onChoose, onClose }: { label: string; items: CapMenuItem[]; x: number; y: number; width?: number; onChoose: (id: string) => void; onClose: () => void }) {
  const menu = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [armed, setArmed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const el = menu.current;
    if (!el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const away = (event: Event) => {
      if (overlayOwnsPointer() || el.contains(event.target as Node)) return;
      closeRef.current();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || overlayOwnsPointer()) return;
      event.preventDefault();
      closeRef.current();
      opener?.focus();
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape);
    (el.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? el).focus();
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape);
      clearTimeout(timer.current);
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (!rows.length) return;
    event.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[(at + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length].focus();
  };

  return (
    <div ref={menu} className="key-menu cap-menu" role="menu" tabIndex={-1} aria-label={label} style={{ left: x, top: y, ...(width ? { width } : {}) }} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item) => {
        const on = armed === item.id;
        return (
          <div key={item.id} className="cap-menu-item">
            {item.rule ? <div className="cap-menu-rule" role="separator" /> : null}
            <button
              type="button"
              role="menuitem"
              className={on ? 'armed' : undefined}
              disabled={item.disabled}
              title={item.help}
              aria-description={item.help}
              onClick={() => {
                if (item.confirm && !on) {
                  setArmed(item.id);
                  clearTimeout(timer.current);
                  timer.current = setTimeout(() => setArmed(null), ARM_MS);
                  return;
                }
                onChoose(item.id);
                onClose();
              }}
            >
              {item.Icon ? <item.Icon size={20} aria-hidden={true} /> : <span className="cap-menu-gap" />}
              <span>{on && item.confirm ? item.confirm : item.label}</span>
              {item.ticked ? <IconCheck className="cap-menu-tick" size={20} stroke={2.2} aria-hidden={true} /> : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}
