import { IconArrowsExchange, IconFileCode, IconPin, IconPinnedOff, IconPlus } from '@tabler/icons-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { invoke } from '../bridge/tauri';
import { overlayOwnsPointer } from '../ribbon/DrawerScrim';

export interface KeyMenuAction {
  id: 'pin' | 'replace' | 'add' | 'remove' | 'file';
  label: string;
  note?: string;
  disabled?: boolean;
}

const icons = { pin: IconPin, replace: IconArrowsExchange, add: IconPlus, remove: IconPinnedOff, file: IconFileCode };

/** How long a menu stays once the pointer rests elsewhere (and focus is not being used by keyboard). */
export const MENU_CLOSE_MS = 5_000;

/**
 * The menu of one key. It closes on Escape, on a press anywhere else, on a choice, and after
 * `MENU_CLOSE_MS` with the pointer away from it; the countdown never runs while the pointer is
 * over the menu, nor while keyboard focus is inside it after a key press (or when it was opened
 * from the keyboard). When it
 * closes by Escape or after a choice, focus goes back to the key.
 */
export function KeyMenu({ title, actions, onChoose, onClose, byKeyboard = false }: { title: string; actions: KeyMenuAction[]; onChoose: (id: KeyMenuAction['id']) => void; onClose: () => void; byKeyboard?: boolean }) {
  const menu = useRef<HTMLDivElement | null>(null);
  // The latest callback, so a parent that re-renders (the keys feed polls) does not restart the effect below.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const byKeyboardRef = useRef(byKeyboard);
  useEffect(() => {
    const el = menu.current;
    if (!el) return;
    const wrap = el.closest('.key-tile-wrap');
    let pointerIn = false;
    let focusIn = false;
    let keyboard = byKeyboardRef.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const restoreFocus = () => wrap?.querySelector<HTMLElement>('.key-tile')?.focus();
    const close = (restore: boolean) => {
      if (restore) restoreFocus();
      closeRef.current();
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = undefined;
      if (pointerIn || (keyboard && focusIn)) return;
      timer = setTimeout(() => close(el.contains(document.activeElement)), MENU_CLOSE_MS);
    };
    const enter = () => {
      pointerIn = true;
      keyboard = false;
      schedule();
    };
    const leave = () => {
      pointerIn = false;
      schedule();
    };
    const focusEnter = () => {
      focusIn = true;
      schedule();
    };
    const focusLeave = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && el.contains(event.relatedTarget)) return;
      focusIn = false;
      schedule();
    };
    const keyInside = () => {
      keyboard = true;
      schedule();
    };
    const away = (event: Event) => {
      const target = event.target as Node;
      if (overlayOwnsPointer() || el.contains(target)) return;
      close(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || overlayOwnsPointer()) return;
      event.preventDefault();
      close(true);
    };
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('focusin', focusEnter);
    el.addEventListener('focusout', focusLeave);
    el.addEventListener('keydown', keyInside);
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape);
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    schedule();
    return () => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('focusin', focusEnter);
      el.removeEventListener('focusout', focusLeave);
      el.removeEventListener('keydown', keyInside);
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape);
      clearTimeout(timer);
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
    <div ref={menu} className="key-menu" role="menu" aria-label={`Options for ${title}`} onKeyDown={onKeyDown}>
      <div className="key-menu-title">{title}</div>
      {actions.map((action) => {
        const Icon = icons[action.id];
        return (
          <button
            key={action.id}
            type="button"
            role="menuitem"
            disabled={action.disabled}
            onClick={() => {
              if (action.id === 'file') void invoke('wall2_open_keys_file');
              onChoose(action.id);
              menu.current?.closest('.key-tile-wrap')?.querySelector<HTMLElement>('.key-tile')?.focus();
              onClose();
            }}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{action.label}</span>
            {action.note && <em>{action.note}</em>}
          </button>
        );
      })}
    </div>
  );
}
