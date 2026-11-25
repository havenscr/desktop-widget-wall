import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { overlayOwnsPointer } from '../ribbon/DrawerScrim';
import { tip } from '../ui/HoverTip';
import { MAX_PIN_NAME } from './pinNames';

/** Width of a text in the key label's font. */
type Measure = (text: string) => number;

/** Whether `name` fits the room a key label has. An unmeasured key (no canvas, no tile yet) accepts any name that the field takes. */
export function nameFits(name: string, avail: number, measure: Measure | null): boolean {
  if (!measure || !(avail > 0)) return true;
  return measure(name.trim()) <= avail;
}

/**
 * The rename popover of an Always here key, like the Label field of the studio key picker: type the name, and a live
 * check says whether it fits the key's tile. Save is off while the name is empty or too long to fit; Reset clears the
 * name (the key shows its own label again); Escape, a press elsewhere and Cancel close it without a change.
 * `avail` and `measure` are the room one tile label has and the width of a text in its font.
 */
export function KeyRename({
  title,
  initial,
  avail,
  measure,
  onSave,
  onReset,
  onClose,
}: {
  title: string;
  initial: string;
  avail: number;
  measure: Measure | null;
  onSave: (name: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const box = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const name = text.trim();
  const fits = nameFits(name, avail, measure);
  const canSave = name.length > 0 && fits;
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    const away = (e: Event) => {
      if (overlayOwnsPointer() || !box.current || box.current.contains(e.target as Node)) return;
      closeRef.current();
    };
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || overlayOwnsPointer()) return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const save = () => {
    if (canSave) onSave(name);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && e.target === input.current) {
      e.preventDefault();
      save();
    }
  };
  return (
    <div ref={box} className="key-rename" role="dialog" aria-label={`Rename ${title}`} onKeyDown={onKeyDown}>
      <div className="key-rename-title">Rename this key</div>
      <input
        ref={input}
        className="pk-search key-rename-field"
        type="text"
        aria-label="Name"
        placeholder="Name for the key"
        maxLength={MAX_PIN_NAME}
        value={text}
        aria-invalid={!fits || undefined}
        onChange={(e) => setText(e.target.value)}
      />
      <div className={`key-rename-fit${fits ? '' : ' bad'}`} role="status">
        {fits ? (name ? 'Fits the key' : 'Type a name for the key') : 'Too long to fit the key'}
      </div>
      <div className="key-rename-btns">
        <button type="button" className="deck-mini key-rename-save" disabled={!canSave} {...tip(canSave ? 'Save the name (Enter)' : 'Type a name that fits the key to save it')} onClick={save}>
          Save
        </button>
        <button type="button" className="deck-mini" {...tip('Clear the name: the key shows its own label again')} onClick={onReset}>
          Reset
        </button>
        <button type="button" className="deck-mini" {...tip('Close without a change (Escape)')} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
