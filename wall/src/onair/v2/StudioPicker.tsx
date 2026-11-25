import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyEvent } from 'react';
import { tip } from '../../ui/HoverTip';
import { useListEdge } from '../../ui/useListEdge';
import { overlayOwnsPointer } from '../../ribbon/DrawerScrim';
import { SLOT_ICON } from './studioIcons';
import { MAX_LABEL, PICKER_ORDER, SLOT_INFO, type Slot, type SlotAction } from './studioSlots';

/**
 * The picker over the studio keys, opened by a right-click on a key: one list, the StreamYard group then
 * the Wall group, a click puts that action on the key. A scene key also has a Label field (its short name).
 * Closes on Escape or a press outside.
 */
export function StudioPicker({
  slot,
  index,
  onChoose,
  onLabel,
  onClose,
}: {
  slot: Slot;
  index: number;
  onChoose: (a: SlotAction) => void;
  onLabel: (label: string) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const edge = useListEdge([slot.a]);
  const scene = !!SLOT_INFO[slot.a].scene;
  const [label, setLabel] = useState(slot.l ?? '');
  // Focus moves into the picker on open: the Label field for a scene key, else the current row.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    (el.querySelector<HTMLElement>('input[aria-label="Label"]') ?? el.querySelector<HTMLElement>('.pk-row.here') ?? el.querySelector<HTMLElement>('.pk-row'))?.focus();
  }, []);
  const onKeyDown = (e: ReactKeyEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const list = [...(box.current?.querySelectorAll<HTMLButtonElement>('button.pk-row') ?? [])];
    if (list.length === 0) return;
    e.preventDefault();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % list.length : (at <= 0 ? list.length : at) - 1;
    list[next].focus();
  };
  useEffect(() => {
    const away = (e: Event) => {
      if (overlayOwnsPointer() || !box.current || box.current.contains(e.target as Node)) return;
      onClose();
      // The click that ends the picker is swallowed once, so a key under the pointer is not also pressed.
      const eat = (c: Event) => {
        c.stopPropagation();
        c.preventDefault();
        stop();
      };
      const stop = () => {
        document.removeEventListener('click', eat, true);
        clearTimeout(timer);
      };
      const timer = setTimeout(stop, 800);
      document.addEventListener('click', eat, true);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || overlayOwnsPointer()) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape);
    };
  }, [onClose]);

  const group = (id: 'streamyard' | 'wall', title: string) => (
    <div className="pk-group" key={id}>
      <div className="pk-gh">{title}</div>
      {PICKER_ORDER[id].map((a) => (
        <button
          key={a}
          type="button"
          className={`pk-row${slot.a === a ? ' here' : ''}`}
          aria-label={SLOT_INFO[a].full}
          {...tip(SLOT_INFO[a].full)}
          onClick={() => onChoose(a)}
        >
          {(() => {
            const I = SLOT_ICON[a];
            return <I size={20} stroke={1.8} aria-hidden="true" />;
          })()}
          <span className="pk-lb">{SLOT_INFO[a].full}</span>
          {slot.a === a && <span className="pk-mark">this key</span>}
        </button>
      ))}
    </div>
  );

  return (
    <div className="pk oa2-skpick" ref={box} role="dialog" aria-label={`Choose the action for studio key ${index + 1}`} onKeyDown={onKeyDown}>
      <div className="pk-top">
        {scene ? (
          <input
            className="pk-search"
            type="text"
            aria-label="Label"
            placeholder={`Label (now ${SLOT_INFO[slot.a].label})`}
            maxLength={MAX_LABEL}
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              onLabel(e.target.value);
            }}
            {...tip('The short name on this key. Leave it empty for the default. The full scene name stays in the hover card.')}
          />
        ) : (
          <span className="pk-purpose-t">Key {index + 1}: pick an action</span>
        )}
        <button type="button" className="deck-mini" aria-label="Close the picker" {...tip('Close (Escape)')} onClick={onClose}>
          Close
        </button>
      </div>
      <div ref={edge.ref} className={`pk-list ${edge.className}`} onScroll={edge.onScroll}>
        {group('streamyard', 'StreamYard')}
        {group('wall', 'Wall')}
      </div>
    </div>
  );
}
