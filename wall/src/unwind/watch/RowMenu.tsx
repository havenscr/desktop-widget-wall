import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconExternalLink, IconLink } from '@tabler/icons-react';
import { tip } from '../../ui/HoverTip';
import { MENU_WIDTH, place } from './AddToPlaylist';
import { kindName } from './links';
import type { SavedItem } from './saved';
import { useMenuLife } from './useMenuLife';

export interface RowMenuProps {
  item: SavedItem;
  /** The row the menu opens under. */
  anchor: HTMLElement;
  host: HTMLElement;
  onEdit: () => void;
  onOpen: () => void;
  /** Closes the menu; `restore` is true when focus should go back to the row. */
  onClose: (restore: boolean) => void;
  byKeyboard?: boolean;
}

/**
 * The menu of one Watch list row (right-click, or Shift+F10 or the Menu key on a focused row): "Edit link" and
 * "Open on YouTube", nothing else. Its life is the pin menu's (`useMenuLife`): Escape, a press elsewhere, a choice
 * and a few seconds with the pointer away close it.
 */
export function RowMenu({ item, anchor, host, onEdit, onOpen, onClose, byKeyboard = false }: RowMenuProps) {
  const menu = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const onKeyDown = useMenuLife(menu, onClose, byKeyboard, 'root');
  useLayoutEffect(() => setAt(place(host, anchor, 'anchor', menu.current?.offsetHeight ?? 0)), [host, anchor]);
  const site = item.kind === 'twitch' ? 'Twitch' : 'YouTube';
  const style = at ? { left: at.left, top: at.top, width: MENU_WIDTH } : { left: 0, top: 0, width: MENU_WIDTH, visibility: 'hidden' as const };
  const choose = (act: () => void, restore: boolean) => () => {
    act();
    onClose(restore);
  };
  return createPortal(
    <div ref={menu} className="u-pin-menu w-rowmenu" role="menu" aria-label={`Options for ${item.label}`} style={style} onKeyDown={onKeyDown}>
      <button type="button" role="menuitem" {...tip(`Change the link of this ${kindName(item.kind).toLowerCase()}`)} onClick={choose(onEdit, false)}>
        <IconLink size={20} aria-hidden="true" />
        <span>Edit link</span>
      </button>
      <button type="button" role="menuitem" {...tip(`Open this page on ${site} in your browser`)} onClick={choose(onOpen, true)}>
        <IconExternalLink size={20} aria-hidden="true" />
        <span>Open on {site}</span>
      </button>
    </div>,
    host,
  );
}
