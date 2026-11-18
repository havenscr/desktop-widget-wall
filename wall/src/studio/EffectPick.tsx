import { IconCheck, IconChevronDown, IconChevronRight, IconSparkles } from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { stageBox } from '../horizon/sky';
import { tip } from '../ui/HoverTip';
import { needsZone } from './homeModel';
import { useHome } from './homeStore';
import type { Group, Studio } from './home';

/** The list is this wide beside the card, and as wide as the row under it in the sheet. */
export const EFFECT_LIST_W = 230;
const STAGE_W = 2560;
const STAGE_H = 720;
const EDGE = 12;

/** The effect that is on, by its words; "Not set" while the home app reports none. */
export const currentEffect = (studio: Studio): string => studio.looks.find((l) => l.active)?.label ?? 'Not set';

/**
 * The Panels effect, as one row: the word "Effect", the one that is on, a chevron. It opens a list with the current
 * one ticked. The list is drawn on the stage, so neither the sheet's scrolling body nor the card clips it, and it
 * adds nothing to the height of the place that holds the row.
 */
export function EffectRow({ studio, panels, may, where }: { studio: Studio; panels: Group; may: boolean; where: 'below' | 'beside' }) {
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLButtonElement>(null);
  const off = !may || needsZone(panels);
  const close = (restore: boolean) => {
    setOpen(false);
    if (restore) row.current?.focus();
  };
  if (studio.looks.length === 0) return null;
  return (
    <>
      <button
        ref={row}
        type="button"
        className={`st-effect${open ? ' open' : ''}${off ? ' dis' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={off ? true : undefined}
        data-effect-row=""
        onClick={off ? undefined : () => setOpen((o) => !o)}
        {...tip(off ? (may ? 'The panels need a Hue zone before an effect can be set' : "The home app is not taking changes right now") : 'Opens the list of effects. The one that is on is ticked.')}
      >
        <IconSparkles size={20} aria-hidden="true" />
        <span className="st-effect-k">Effect</span>
        <span className="st-effect-v">{currentEffect(studio)}</span>
        {open ? <IconChevronDown size={20} aria-hidden="true" /> : <IconChevronRight size={20} aria-hidden="true" />}
      </button>
      {open && <EffectList studio={studio} anchor={row} where={where} onClose={close} />}
    </>
  );
}

function EffectList({ studio, anchor, where, onClose }: { studio: Studio; anchor: React.RefObject<HTMLButtonElement | null>; where: 'below' | 'beside'; onClose: (restore: boolean) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const writes = useHome((s) => s.writes);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const items = studio.looks;
  const start = Math.max(0, items.findIndex((l) => l.active));

  useLayoutEffect(() => {
    const read = () => {
      const a = anchor.current ? stageBox(anchor.current) : null;
      if (!a) {
        // No measurable row (not drawn yet): the list still shows, at the stage's corner, rather than staying hidden.
        setPos({ left: EDGE, top: EDGE, width: EFFECT_LIST_W });
        return;
      }
      const [x, y, w, h] = a;
      const height = items.length * 34 + 12;
      if (where === 'below') {
        const top = Math.min(y + h + 6, STAGE_H - EDGE - height);
        setPos({ left: x, top, width: w });
        return;
      }
      // Beside the card (right of it, else left), its top lined up with the row.
      const card = anchor.current?.closest('.st-gcard');
      const c = card ? stageBox(card) : null;
      const cx = c ? c[0] : x;
      const cw = c ? c[2] : w;
      const right = cx + cw + 6;
      const left = right + EFFECT_LIST_W <= STAGE_W - EDGE ? right : Math.max(EDGE, cx - 6 - EFFECT_LIST_W);
      setPos({ left, top: Math.max(EDGE, Math.min(y, STAGE_H - EDGE - height)), width: EFFECT_LIST_W });
    };
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [anchor, items.length, where]);

  useEffect(() => {
    list.current?.querySelectorAll<HTMLElement>('[role="option"]')[start]?.focus();
  }, [pos === null]);

  useEffect(() => {
    // Escape and a press elsewhere close the list first; the card or the sheet under it stays.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose(true);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || list.current?.contains(t) || anchor.current?.contains(t) || t.closest('.hover-tip')) return;
      onClose(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, []);

  const move = (to: number) => {
    const opts = list.current?.querySelectorAll<HTMLElement>('[role="option"]');
    if (!opts?.length) return;
    opts[(to + opts.length) % opts.length].focus();
  };
  const keys = (e: KeyboardEvent) => {
    const opts = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const at = opts.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') (e.preventDefault(), move(at + 1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), move(at - 1));
    else if (e.key === 'Home') (e.preventDefault(), move(0));
    else if (e.key === 'End') (e.preventDefault(), move(opts.length - 1));
    else if (e.key === 'Tab') {
      // Tab leaves the list for the row, so the sheet's own Tab loop never sees a control outside it.
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    }
  };
  const host = document.querySelector('.stage') ?? document.body;
  return createPortal(
    <div ref={list} className="st-eflist" role="listbox" aria-label="Effects" style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: 'hidden' }} onKeyDown={keys}>
      {items.map((l) => (
        <button
          key={l.id}
          type="button"
          role="option"
          aria-selected={l.active}
          className={`st-ef${l.active ? ' on' : ''}`}
          aria-busy={writes > 0 || undefined}
          tabIndex={-1}
          onClick={() => {
            if (!l.active) void useHome.getState().applyLook(l.id);
            onClose(true);
          }}
        >
          <span className="st-ef-tick">{l.active && <IconCheck size={18} aria-hidden="true" />}</span>
          <span className="st-ef-n">{l.label}</span>
        </button>
      ))}
    </div>,
    host,
  );
}
