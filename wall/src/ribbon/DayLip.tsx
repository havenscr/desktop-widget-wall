import { useEffect, useRef, useState } from 'react';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { tip } from '../ui/HoverTip';

/** How long the pointer rests on the lip before it lights. */
export const LIP_INTENT_MS = 180;

/** What the lip's band never takes the pointer from at rest: anything of the wall that acts on a click. */
export const CLICKABLE = 'button, a[href], [role="button"], [tabindex]:not([tabindex="-1"]), .lane[data-id], .ev, .key-tile, .watt-hit, .tk3, .sg-hit';

/**
 * The Day drawer's handle: the strip's whole top edge. One button, 26 px tall, from 17 px above
 * the strip's top edge (the empty gap over it) to 9 px inside it, so it ends above the hour
 * labels, the sun labels and the all-day bar; the needle's time pill draws over it. At rest it
 * is a hairline along the edge and one chevron (at `x`, which steps aside from the labels as the
 * old handle did); under the pointer a full-width lip lights with the chevron and "Open the
 * day", but only after the pointer has rested in the band for `LIP_INTENT_MS` (so crossing the
 * edge on the way to a card never flashes the words across the wall; leaving cancels at once).
 * Keyboard focus and the open state show the words with no delay.
 *
 * At rest the band never takes the pointer from anything of the wall that acts on a click (an
 * agent card, a folded chip, a key, the buddy standing on the edge): while the pointer is over
 * such a thing in the band the lip is `data-pass` (no pointer events, only the chevron stays a
 * target) and does not light. The pointer is followed on the window, because a lip that lets the
 * pointer through no longer hears it.
 *
 * With the drawer open the same lip sits on the drawer's top edge and reads "Close the day".
 * Enter and Space work as a click. Keyboard focus follows the drawer's own rule
 * (`useBehindDrawer`): into the drawer on open, back to the strip's handle on close; the
 * drawer's lip carries `in-drawer` so that rule finds the strip's one.
 */
export function DayLip({ open, x, onToggle }: { open: boolean; x: number | null; onToggle: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [intent, setIntent] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resting = false;
    const off = () => {
      clearTimeout(timer);
      resting = false;
      setIntent(false);
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside || el.closest('[inert]')) {
        delete el.dataset.pass;
        if (resting) off();
        return;
      }
      const blocked = !open && document.elementsFromPoint(e.clientX, e.clientY).some((n) => !el.contains(n) && n.closest(CLICKABLE) !== null);
      if (blocked) {
        el.dataset.pass = '';
        if (resting) off();
        return;
      }
      delete el.dataset.pass;
      if (!resting) {
        resting = true;
        timer = setTimeout(() => setIntent(true), LIP_INTENT_MS);
      }
    };
    const gone = () => {
      delete el.dataset.pass;
      off();
    };
    window.addEventListener('pointermove', move);
    document.documentElement.addEventListener('pointerleave', gone);
    return () => {
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', gone);
      clearTimeout(timer);
    };
  }, [open]);
  const name = open ? 'Close the day' : 'Open the day';
  const Chevron = open ? IconChevronDown : IconChevronUp;
  return (
    <button
      ref={ref}
      type="button"
      className={`rib-handle day-lip${open ? ' open in-drawer' : ''}${intent ? ' intent' : ''}`}
      aria-label={name}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!e.repeat) onToggle();
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
