import type { ReactNode } from 'react';
import { create } from 'zustand';
import type { LibraryPin } from './pins';

/** One action of a library menu: it runs once, after the menu has closed. `restore` false leaves focus where the action put it (a hand-over to another menu). */
export interface MenuAction {
  id: string;
  label: string;
  icon: ReactNode;
  run: () => void;
  chevron?: boolean;
  restore?: boolean;
}

export interface OpenLibraryMenu {
  /** What the Pin row and the chooser would pin; checked by `makeLibraryPin` when it matters. */
  entry: Pick<LibraryPin, 'kind' | 'id' | 'name'> & { art?: string };
  name: string;
  actions: MenuAction[];
  /** A pointer position, or the source's rectangle (a keyboard opening, or the opened-view button). */
  at: { x: number; y: number } | DOMRect;
  source: HTMLElement;
  view: 'actions' | 'chooser';
  /** True when the menu was opened straight onto the chooser (the opened-view Pin button): ArrowLeft has nowhere to go back to. */
  chooserOnly: boolean;
  byKeyboard: boolean;
}

interface State {
  open: OpenLibraryMenu | null;
}

/** At most one library menu is open at a time. */
export const useLibraryMenu = create<State>(() => ({ open: null }));

export function openLibraryMenu(menu: Omit<OpenLibraryMenu, 'view' | 'chooserOnly'> & { view?: 'actions' | 'chooser'; chooserOnly?: boolean }): void {
  useLibraryMenu.setState({ open: { view: 'actions', chooserOnly: false, ...menu } });
}

/** Close the open menu; `restore` gives focus back to the source (the caller then also keeps the source's hover card closed). */
export function closeLibraryMenu(restore = false): void {
  const m = useLibraryMenu.getState().open;
  if (!m) return;
  useLibraryMenu.setState({ open: null });
  if (restore && m.source.isConnected) focusSource(m.source);
}

/** Set by the sources that show a hover card on focus (the Spotify tile), so focus returned after a menu does not reopen the card. */
let focusHook: ((el: HTMLElement) => void) | null = null;
export function setSourceFocus(fn: ((el: HTMLElement) => void) | null): void {
  focusHook = fn;
}
function focusSource(el: HTMLElement): void {
  if (focusHook) focusHook(el);
  else el.focus();
}

/** True while a library menu is open (a tile or row does not show its hover card then). */
export function libraryMenuOpen(): boolean {
  return useLibraryMenu.getState().open !== null;
}

/**
 * Where a box of `w` by `h` goes in a window of `iw` by `ih`: a pointer opening puts the top left corner at the pointer, a rectangle
 * opening at the rectangle's bottom left. A box that would pass 8 px from the foot opens upward (its bottom edge at the pointer, or at the
 * rectangle's top); one that would pass 8 px from the right edge opens leftward (its right edge at the pointer, or at the rectangle's right);
 * after any flip it is clamped 8 px inside the window on every side.
 */
export function placeBox(at: { x: number; y: number } | DOMRect, w: number, h: number, iw: number, ih: number): { left: number; top: number } {
  const rect = 'width' in at;
  const x = rect ? at.left : at.x;
  const y = rect ? at.bottom : at.y;
  const yUp = rect ? at.top : at.y;
  const xLeft = rect ? at.right : at.x;
  let left = x;
  let top = y;
  if (top + h > ih - 8) top = yUp - h;
  if (left + w > iw - 8) left = xLeft - w;
  left = Math.max(8, Math.min(left, iw - 8 - w));
  top = Math.max(8, Math.min(top, ih - 8 - h));
  return { left, top };
}
