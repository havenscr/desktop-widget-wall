import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { tip } from '../ui/HoverTip';
import { KeyIcon } from './keyIcons';
import { searchLibrary, type LibGroup, type LibKey } from './libraryModel';
import type { KeyInfo } from './keysModel';

/** Why a library row cannot be pinned, or null when it can. */
export function rowBlock(k: LibKey): string | null {
  if (k.kind === 'soon') return 'Coming: this key needs a change that is not in yet';
  if (!k.runnable) return 'This shortcut still has to be worked out on your PC';
  return null;
}

/**
 * The small picker over the deck: the library by group with a search box, the current pins
 * marked, a click swaps the key into the slot that was right-clicked. Closes on Escape or a
 * click outside. Rows are 36 px tall. It covers the two key rows only, never Next three.
 */
export function KeyPicker({
  lib,
  filePins,
  pins,
  slot,
  onChoose,
  onReset,
  onClose,
}: {
  lib: LibGroup[];
  filePins: KeyInfo[];
  /** The refs now in the row, in order. */
  pins: string[];
  slot: number;
  onChoose: (ref: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement | null>(null);
  const search = useRef<HTMLInputElement | null>(null);
  const groups = useMemo(() => searchLibrary(lib, query), [lib, query]);
  useEffect(() => search.current?.focus(), []);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [onClose]);

  const rows = (): HTMLButtonElement[] => [...(box.current?.querySelectorAll<HTMLButtonElement>('button.pk-row:not([aria-disabled="true"])') ?? [])];
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const list = rows();
    if (list.length === 0) return;
    e.preventDefault();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % list.length : (at <= 0 ? list.length : at) - 1;
    list[next].focus();
  };

  const current = pins[slot] ?? null;
  return (
    <div className="pk" ref={box} role="dialog" aria-label={`Choose the key for slot ${slot + 1}`} onKeyDown={onKeyDown}>
      <div className="pk-top">
        <input
          ref={search}
          className="pk-search"
          type="search"
          placeholder="Search keys"
          aria-label="Search keys"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="deck-mini" aria-label="Close the picker" {...tip('Close (Escape)')} onClick={onClose}>
          Close
        </button>
      </div>
      <div className="pk-list">
        {filePins.length > 0 && query.trim() === '' && (
          <div className="pk-group">
            <div className="pk-gh">From keys.json</div>
            {filePins.map((k, i) => (
              <Row key={`file:${i}`} label={k.label} icon={k.icon} how="From keys.json" pinned={pins.includes(`file:${i}`)} here={current === `file:${i}`} onPick={() => onChoose(`file:${i}`)} />
            ))}
          </div>
        )}
        {groups.map((g) => (
          <div className="pk-group" key={g.id}>
            <div className="pk-gh">{g.title}</div>
            {g.keys.map((k) => (
              <Row
                key={k.id}
                label={k.label}
                icon={k.icon}
                how={k.how}
                badge={k.kind === 'check' ? 'check' : k.kind === 'soon' ? 'coming' : null}
                block={rowBlock(k)}
                pinned={pins.includes(`lib:${k.id}`)}
                here={current === `lib:${k.id}`}
                onPick={() => onChoose(`lib:${k.id}`)}
              />
            ))}
          </div>
        ))}
        {groups.length === 0 && <div className="pk-none">No key matches that search</div>}
      </div>
      <button type="button" className="pk-reset" {...tip('Go back to the keys that come with the wall (or the ones keys.json names)')} onClick={onReset}>
        Reset to defaults
      </button>
    </div>
  );
}

function Row({
  label,
  icon,
  how,
  badge = null,
  block = null,
  pinned,
  here,
  onPick,
}: {
  label: string;
  icon: string;
  how: string;
  badge?: string | null;
  block?: string | null;
  pinned: boolean;
  here: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className={`pk-row${pinned ? ' pinned' : ''}${here ? ' here' : ''}${block ? ' off' : ''}`}
      aria-disabled={block ? true : undefined}
      aria-label={`${label}${pinned ? ', pinned' : ''}${badge ? `, ${badge}` : ''}`}
      {...tip(block ?? (badge === 'check' ? `${how}. Confirm this shortcut on your PC; it is switched off in the automatic sets until you pin it.` : how))}
      onClick={() => !block && onPick()}
    >
      <KeyIcon name={icon} size={18} />
      <span className="pk-lb">{label}</span>
      {badge && <span className={`pk-badge ${badge}`}>{badge}</span>}
      {pinned && <span className="pk-mark">{here ? 'this slot' : 'pinned'}</span>}
    </button>
  );
}
