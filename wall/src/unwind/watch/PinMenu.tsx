import { IconArrowsExchange, IconDeviceTv, IconPinnedOff } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { tip } from '../../ui/HoverTip';
import { PinGlyph } from './PinGlyph';
import { PIN_MENU_CLOSE_MS, useMenuLife } from './useMenuLife';
import { refKey } from './links';
import type { SavedItem } from './saved';

export { PIN_MENU_CLOSE_MS };

export interface PinMenuProps {
  /** Items the list offers: every Watch list item not already pinned. */
  items: readonly SavedItem[];
  /** True when the Watch list has any item at all (an empty list says to add a video first). */
  listHasItems: boolean;
  /** True for a place that holds a pin: the menu then opens with Replace and Remove, and the list follows Replace. */
  pinned: boolean;
  /** The pin's name, for the menu's label. */
  name: string;
  onPick: (key: string) => void;
  onRemove: () => void;
  onOpenWatch: () => void;
  /** Closes the menu; `restore` is true when focus should go back to the pin. */
  onClose: (restore: boolean) => void;
  byKeyboard?: boolean;
}

/**
 * The menu of one pin place, built as the key deck's menu behaves (`KeyMenu`): it closes on Escape,
 * on a press anywhere else, on a choice, and after `PIN_MENU_CLOSE_MS` with the pointer away; the
 * countdown never runs while the pointer is over it, nor while keyboard focus is inside after a key
 * press (or when it was opened from the keyboard). Escape and a choice give focus back to the pin.
 * An empty place opens the list at once ("Pin from the Watch list"); a pin opens Replace and Remove,
 * and Replace brings the list.
 */
export function PinMenu({ items, listHasItems, pinned, name, onPick, onRemove, onOpenWatch, onClose, byKeyboard = false }: PinMenuProps) {
  const menu = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [view, setView] = useState<'root' | 'list'>(pinned ? 'root' : 'list');
  const onKeyDown = useMenuLife(menu, onClose, byKeyboard, view);

  const choose = (act: () => void) => () => {
    act();
    closeRef.current(true);
  };

  return (
    <div ref={menu} className="u-pin-menu" role="menu" aria-label={`Options for ${name}`} onKeyDown={onKeyDown}>
      {view === 'root' ? (
        <>
          <div className="u-pin-menu-title">{name}</div>
          <button type="button" role="menuitem" onClick={() => setView('list')}>
            <IconArrowsExchange size={20} aria-hidden="true" />
            <span>Replace</span>
          </button>
          <button type="button" role="menuitem" onClick={choose(onRemove)}>
            <IconPinnedOff size={20} aria-hidden="true" />
            <span>Remove</span>
          </button>
        </>
      ) : (
        <>
          <div className="u-pin-menu-title">Pin from the Watch list</div>
          {!listHasItems ? (
            <>
              <p className="u-pin-menu-note">Add a video to the Watch list first.</p>
              <button type="button" role="menuitem" onClick={choose(onOpenWatch)}>
                <IconDeviceTv size={20} aria-hidden="true" />
                <span>Open Watch</span>
              </button>
            </>
          ) : items.length === 0 ? (
            <p className="u-pin-menu-note">Everything in the Watch list is pinned already.</p>
          ) : (
            <div className="u-pin-menu-list">
              {items.map((item) => (
                <button key={refKey(item)} type="button" role="menuitem" {...tip(item.label)} onClick={choose(() => onPick(refKey(item)))}>
                  <PinGlyph kind={item.kind} size={20} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
