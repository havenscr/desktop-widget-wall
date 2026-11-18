import { IconBulb, IconX } from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { overlayOwnsPointer } from '../ribbon/DrawerScrim';
import { KELVIN_MAX, KELVIN_MIN } from './keyLights';
import { drawerBox, openerColumn } from './drawerBox';
import { KeyPanel } from './KeyControls';
import { ABSENT_LINE, DOWN_LINE } from './homeModel';
import { SheetPresets, SheetRooms, SheetWhy, useSheetHome } from './SheetHome';
import { useHomePolling } from './useHomePolling';
import { useKeyLights } from './store';

/** The drawer closes by itself after this long with no pointer over it, as the Tools drawer does. */
export const DRAWER_IDLE_MS = 120_000;

/** Fine tune: the key lights' sliders, linked or one light at a time. Mounted by whoever opens it (On Air, the Work chip). */
export function StudioDrawer() {
  const note = useKeyLights((s) => s.note);
  useHomePolling();
  const home = useSheetHome();
  const ref = useRef<HTMLElement>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const close = () => useKeyLights.getState().setDrawer(false);

  // The sheet overlays the column that holds its opener and nothing beside it: read when it opens and
  // again when the column or the canvas changes size.
  const [box, setBox] = useState(() => drawerBox());
  useLayoutEffect(() => {
    const read = () => setBox((old) => {
      const next = drawerBox();
      return old.left === next.left && old.width === next.width ? old : next;
    });
    read();
    window.addEventListener('resize', read);
    const col = openerColumn();
    const watch = col && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    if (col) watch?.observe(col);
    return () => {
      window.removeEventListener('resize', read);
      watch?.disconnect();
    };
  }, []);

  // Focus goes into the drawer when it opens and back to the control that opened it when it closes.
  useEffect(() => {
    const node = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.querySelector<HTMLElement>('.st-x')?.focus();
    return () => {
      const now = document.activeElement;
      // Not taken from a control the pointer or a key has already moved focus to.
      if (opener?.isConnected && (!now || now === document.body || node?.contains(now))) opener.focus();
    };
  }, []);
  // Tab stays inside while it is open.
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? [])];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const now = document.activeElement;
    if (e.shiftKey && (now === first || !ref.current?.contains(now))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (now === last || !ref.current?.contains(now))) {
      e.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || overlayOwnsPointer()) return;
      e.preventDefault();
      close();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (overlayOwnsPointer() || !t || ref.current?.contains(t) || t.closest('[data-st-opener]') || t.closest('.hover-tip') || t.closest('.st-eflist')) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, []);
  const startIdle = () => {
    clearTimeout(idle.current);
    idle.current = setTimeout(close, DRAWER_IDLE_MS);
  };
  useEffect(() => {
    startIdle();
    return () => clearTimeout(idle.current);
  }, []);

  const host = document.querySelector('.stage') ?? document.body;
  return createPortal(
    <section ref={ref} className="st-drawer" data-home={home.studio ? '' : undefined} style={{ left: box.left, width: box.width }} aria-label="Studio lights" onKeyDown={trap} onPointerEnter={() => clearTimeout(idle.current)} onPointerLeave={startIdle}>
      <div className="st-d-top">
        <IconBulb size={22} className="st-bulb" aria-hidden="true" />
        <span className="k st-title">Studio lights</span>
        <span className="st-office">Office only</span>
        {home.studio && <SheetWhy studio={home.studio} away={home.away} />}
        <button type="button" className="st-x" aria-label="Close Studio lights" onClick={close}>
          <IconX size={18} aria-hidden="true" />
        </button>
      </div>
      {home.studio && <SheetPresets studio={home.studio} may={home.may} />}
      <div className={home.studio ? 'st-d-body' : 'st-d-body one'}>
      <KeyPanel withSwitch />
      {home.studio && <SheetRooms studio={home.studio} may={home.may} />}
      </div>
      {note && (
        <div className="st-line st-note amber" role="status">
          {note}
        </div>
      )}
      {!home.studio && home.view !== 'checking' && <div className="st-line st-quiet">{home.view === 'down' ? `${DOWN_LINE}.` : ABSENT_LINE}</div>}
      <div className="st-d-foot st-line">
        <span>{home.studio ? `Range ${KELVIN_MIN} K to ${KELVIN_MAX} K, maker's figure` : `Range ${KELVIN_MIN} K to ${KELVIN_MAX} K, the maker's figure`}</span>
        <span>Esc or a click outside closes it</span>
      </div>
    </section>,
    host,
  );
}
