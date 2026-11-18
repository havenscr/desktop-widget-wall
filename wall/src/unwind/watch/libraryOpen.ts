import type { KeyboardEvent, MouseEvent } from 'react';
import { openLibraryMenu, type MenuAction, type OpenLibraryMenu } from './libraryMenu';

/** What a source (a tile or row) gives to open its menu: what it would pin, its name and its actions. */
export interface LibrarySource {
  entry: OpenLibraryMenu['entry'];
  name: string;
  actions: () => MenuAction[];
}

/**
 * The handlers that open a library menu from a source: a right-click (at the pointer), the ContextMenu key and Shift+F10 (at the
 * source's rectangle). Actions are built when the menu opens, so they see the latest props.
 */
export function libraryHandlers(source: LibrarySource) {
  return {
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      e.preventDefault();
      openLibraryMenu({ entry: source.entry, name: source.name, actions: source.actions(), at: { x: e.clientX, y: e.clientY }, source: e.currentTarget, byKeyboard: false });
    },
    /** True when the key opened the menu. */
    onMenuKey: (e: KeyboardEvent<HTMLElement>): boolean => {
      if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return false;
      e.preventDefault();
      openLibraryMenu({ entry: source.entry, name: source.name, actions: source.actions(), at: e.currentTarget.getBoundingClientRect(), source: e.currentTarget, byKeyboard: true });
      return true;
    },
  };
}
