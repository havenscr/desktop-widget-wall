import { useEffect, useRef } from 'react';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { tip } from '../ui/HoverTip';

/**
 * The Day drawer's handle: the strip's whole top edge. One button, 26 px tall, from 17 px above
 * the strip's top edge (the empty gap over it) to 9 px inside it, so it ends above the hour
 * labels, the sun labels and the all-day bar; the needle's time pill draws over it. At rest it
 * is a hairline along the edge and one chevron (at `x`, which steps aside from the labels as the
 * old handle did); under the pointer a full-width lip lights with the chevron and "Open the
 * day". With the drawer open the same lip sits on the drawer's top edge and reads "Close the
 * day". Enter and Space work as a click; `focusOnMount` keeps keyboard focus on the handle
 * when it moves between the strip and the drawer.
 */
export function DayLip({ open, x, onToggle, focusOnMount = false }: { open: boolean; x: number | null; onToggle: (byKey: boolean) => void; focusOnMount?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
    // Only when it mounts.
  }, []);
  const name = open ? 'Close the day' : 'Open the day';
  const Chevron = open ? IconChevronDown : IconChevronUp;
  return (
    <button
      ref={ref}
      type="button"
      className={`rib-handle day-lip${open ? ' open' : ''}`}
      aria-label={name}
      aria-expanded={open}
      onClick={(e) => onToggle(e.detail === 0)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!e.repeat) onToggle(true);
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ') e.preventDefault();
      }}
      {...tip(() => (
        <>
          <span className="tip-t">{name}</span>
          <span className="tip-s">{open ? 'Back to the wall (Escape does the same)' : 'Your meetings by the hour, and every agent session today'}</span>
        </>
      ))}
    >
      <i className="lip-line" aria-hidden="true" />
      <span className="lip-pill" style={x === null ? undefined : { left: x }} aria-hidden="true">
        <Chevron stroke={2} />
        <span className="lip-t">{name}</span>
      </span>
    </button>
  );
}
