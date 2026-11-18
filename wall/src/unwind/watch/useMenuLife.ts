import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { overlayOwnsPointer } from '../../ribbon/DrawerScrim';
import { LIBRARY_MENU_OPENED } from './libraryMenuModel';

/** How long a pin menu stays once the pointer rests elsewhere (never while keyboard focus is being used inside it). */
export const PIN_MENU_CLOSE_MS = 5_000;

/**
 * The life of a pin or library menu, shared so the two cannot drift: it closes on Escape, on a press anywhere else, and
 * after `PIN_MENU_CLOSE_MS` with the pointer away; the countdown never runs while the pointer is over it, nor while keyboard
 * focus is inside after a key press (or when it was opened from the keyboard). The first row takes focus each time `view`
 * changes, and ArrowUp and ArrowDown walk the rows. `onClose(restore)` is told whether focus should go back to the source.
 * Returns the menu's `onKeyDown`.
 */
export function useMenuLife(menu: RefObject<HTMLElement | null>, onClose: (restore: boolean) => void, byKeyboard: boolean, view: string): (event: KeyboardEvent) => void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const byKeyboardRef = useRef(byKeyboard);

  useEffect(() => {
    const el = menu.current;
    if (!el) return;
    let pointerIn = false;
    let focusIn = false;
    let keyboard = byKeyboardRef.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = (restore: boolean) => closeRef.current(restore);
    const schedule = () => {
      clearTimeout(timer);
      timer = undefined;
      if (pointerIn || (keyboard && focusIn)) return;
      timer = setTimeout(() => close(el.contains(document.activeElement)), PIN_MENU_CLOSE_MS);
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
      if (overlayOwnsPointer() || el.contains(event.target as Node)) return;
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
    // A library menu opening closes this one (the pin menu closes it; the library menu itself is not affected: it opens after the event).
    const other = () => close(false);
    document.addEventListener(LIBRARY_MENU_OPENED, other);
    schedule();
    return () => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('focusin', focusEnter);
      el.removeEventListener('focusout', focusLeave);
      el.removeEventListener('keydown', keyInside);
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape);
      document.removeEventListener(LIBRARY_MENU_OPENED, other);
      clearTimeout(timer);
    };
  }, [menu]);

  // The first row takes focus each time the menu changes its content.
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [menu, view]);

  return (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (!rows.length) return;
    event.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[(at + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]!.focus();
  };
}
