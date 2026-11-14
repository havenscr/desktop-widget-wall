import { IconArrowsExchange, IconDots, IconFileCode, IconPin, IconPinnedOff } from '@tabler/icons-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { invoke } from '../bridge/tauri';
import { overlayOwnsPointer } from '../ribbon/DrawerScrim';
import { tip } from '../ui/HoverTip';

export interface KeyMenuAction {
  id: 'pin' | 'replace' | 'remove' | 'file';
  label: string;
  note?: string;
  disabled?: boolean;
}

export function KeyMenuButton({ label, open, onOpen }: { label: string; open: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={`key-more${open ? ' on' : ''}`}
      aria-label={`More options for ${label}`}
      aria-haspopup="menu"
      aria-expanded={open}
      {...tip(`More options for ${label}`)}
      onClick={(event) => {
        event.stopPropagation();
        if (!overlayOwnsPointer()) onOpen();
      }}
    >
      <IconDots size={18} aria-hidden="true" />
    </button>
  );
}

const icons = { pin: IconPin, replace: IconArrowsExchange, remove: IconPinnedOff, file: IconFileCode };

export function KeyMenu({ title, actions, onChoose, onClose }: { title: string; actions: KeyMenuAction[]; onChoose: (id: KeyMenuAction['id']) => void; onClose: () => void }) {
  const menu = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const away = (event: Event) => {
      if (overlayOwnsPointer() || menu.current?.contains(event.target as Node)) return;
      onClose();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || overlayOwnsPointer()) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape);
    const timer = setTimeout(onClose, 5_000);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape);
      clearTimeout(timer);
    };
  }, [onClose]);

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
