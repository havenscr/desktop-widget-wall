import { IconAlertTriangle, IconRefresh, IconSettings } from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { stageBox } from '../horizon/sky';
import { useToolsStore } from '../tools/store';
import { EffectRow } from './EffectPick';
import { KeyPanel } from './KeyControls';
import { closeCard, useCard, type CardId } from './cardStore';
import { needsZone, wouldBeDark } from './homeModel';
import { canChange, useHome } from './homeStore';
import type { Group, Studio } from './home';
import { RoomSliderRow } from './SheetHome';
import { noneTitle, viewOf, type Snapshot } from './model';
import { useKeyLights } from './store';

const STAGE_W = 2560;
const STAGE_H = 720;
const EDGE = 12;
/** The card is this wide; a card that gives a reason is wider, so the words show whole. */
export const CARD_W = 340;
export const CARD_REASON_W = 380;
const ABOVE_TILE = 12;
const CARD_INSET = 32;

/**
 * The reason a group's controls cannot be used, in full. Null when they can. Not this: "it cannot go off now" is about
 * switching off, not dimming, so it is no blocker (see `darkLine`).
 */
export function whyNot(studio: Studio, g: Group, may: boolean): { head: string; text: string } | null {
  if (needsZone(g)) return { head: 'Needs a Hue zone before the wall can switch it.', text: 'The home app makes the zone. Its README says how.' };
  if (!g.reachable) return { head: 'Not answering.', text: 'The wall can switch it only after the home app reads it again.' };
  if (!may) return { head: 'View only here.', text: "To switch it from the wall, add the home app's desk token in Tools." };
  void studio;
  return null;
}

/** The one short line beside a slider when the group cannot be switched off now (it can still be dimmed), else null. */
export function darkLine(studio: Studio, g: Group): string | null {
  return wouldBeDark(studio, g) ? 'It cannot go off now: one room light stays on.' : null;
}

/**
 * The small card on a group's name: that group's own settings. One at a time; Escape or a press elsewhere closes it;
 * it is drawn on the stage above the tile, with a tail on the name.
 */
export function GroupCard() {
  const open = useCard((s) => s.open);
  const byKeyboard = useCard((s) => s.byKeyboard);
  const drawer = useKeyLights((s) => s.drawer);
  const studio = useHome((s) => s.studio);
  const readWord = useHome((s) => s.readWord);
  const readDone = useHome((s) => s.readDone);
  const status = useKeyLights((s) => s.status);
  const left = useKeyLights((s) => s.left);
  const right = useKeyLights((s) => s.right);
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; bottom: number; tail: number } | null>(null);
  const snap: Snapshot = { status, left, right };
  const away = readWord !== null;
  const may = canChange({ studio, readWord, readDone });
  const group = studio && open && open !== 'keys' ? studio.groups.find((g) => g.id === open) : undefined;
  const v = viewOf(snap);
  const hasHome = studio !== null;

  // Nothing to show for this id any more (the home app's group went, the sheet opened): the card goes.
  const gone = open === null || drawer || (open !== 'keys' && !group);
  const reason = open === 'keys' ? v === 'none' || v === 'unset' || v === 'checking' : group ? (away ? true : whyNot(studio as Studio, group, may) !== null || darkLine(studio as Studio, group) !== null) : false;
  const width = reason ? CARD_REASON_W : CARD_W;

  useEffect(() => {
    if (gone && open !== null) closeCard();
  }, [gone, open]);

  const anchor = (id: CardId) => document.querySelector<HTMLElement>(`[data-card-for="${id}"]`);
  const focusName = () => (open ? anchor(open) : null)?.focus();

  useLayoutEffect(() => {
    if (!open || gone) {
      setPlace(null);
      return;
    }
    const read = () => {
      const name = anchor(open);
      const tile = name?.closest('.st-tg');
      const n = name ? stageBox(name) : null;
      const t = tile ? stageBox(tile) : null;
      if (!n || !t) {
        // Not measurable (not drawn yet): the card still shows, at a plain place, rather than not at all.
        setPlace({ left: EDGE, bottom: 240, tail: 20 });
        return;
      }
      // The card starts 32 px in from the block's left edge, moved right only as far as its tail needs to stay over the name.
      const blk = tile?.closest('.st-block');
      const b = blk ? stageBox(blk) : null;
      const mid = n[0] + n[2] / 2;
      const want = (b ? b[0] : t[0]) + CARD_INSET;
      const x = Math.max(EDGE, Math.min(Math.max(want, mid - width + 28), STAGE_W - EDGE - width));
      setPlace({ left: x, bottom: 720 - (t[1] - ABOVE_TILE), tail: Math.max(14, Math.min(width - 28, mid - x - 7)) });
    };
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [open, gone, width, hasHome, studio]);

  // Inside the 720 px stage: the card's top and bottom stay EDGE px from its edges, whatever its height.
  useLayoutEffect(() => {
    if (!place || !ref.current) return;
    const b = stageBox(ref.current);
    if (!b) return;
    const bottom = Math.max(EDGE, Math.min(place.bottom, STAGE_H - EDGE - b[3]));
    if (bottom !== place.bottom) setPlace({ ...place, bottom });
  }, [place]);

  useEffect(() => {
    if (!open || gone) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      closeCard();
      focusName();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      // The name toggles its own card; the effect list is part of the card.
      if (!t || ref.current?.contains(t) || t.closest('[data-card-for]') || t.closest('.st-eflist') || t.closest('.hover-tip')) return;
      closeCard();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, gone]);

  // Opened from the keyboard: focus goes to the first control in the card.
  useEffect(() => {
    if (!open || gone || !place || !byKeyboard) return;
    // The card itself takes focus, so the first Tab lands on its first control and no tip opens by itself.
    ref.current?.focus();
  }, [open, gone, place === null, byKeyboard]);

  // Tab runs out of the card at either end: the card closes and focus returns to the name.
  const trap = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? [])];
    const first = items[0];
    const last = items[items.length - 1];
    const now = document.activeElement;
    // A card with nothing to focus (a reason only) closes on any Tab.
    if (items.length === 0 || (e.shiftKey && (now === first || now === ref.current)) || (!e.shiftKey && now === last)) {
      e.preventDefault();
      closeCard();
      focusName();
    }
  };

  if (!open || gone || !place) return null;
  const host = document.querySelector('.stage') ?? document.body;
  const label = open === 'keys' ? 'Key lights' : (group?.label ?? '');
  return createPortal(
    <div ref={ref} className="st-gcard" data-card={open} role="dialog" tabIndex={-1} aria-label={`${label} settings`} style={{ left: place.left, bottom: place.bottom, width }} onKeyDown={trap}>
      {open === 'keys' ? <KeysCard v={v} snap={snap} /> : group && studio ? <RoomCard studio={studio} g={group} may={may} away={away} /> : null}
      <i className="st-gcard-tail" style={{ left: place.tail }} aria-hidden="true" />
    </div>,
    host,
  );
}

function ReasonLines({ head, text, tone = 'amber' }: { head: string; text: string; tone?: 'amber' | 'plain' }) {
  return (
    <>
      <div className={`st-gcard-why${tone === 'amber' ? ' amber' : ''}`} role="status">
        {tone === 'amber' && <IconAlertTriangle size={20} aria-hidden="true" />}
        <span>{head}</span>
      </div>
      {text && <div className="st-line st-gcard-line">{text}</div>}
    </>
  );
}

/** The Key lights card: the same sliders and the Linked control as the sheet; a reason when they cannot be used. */
function KeysCard({ v, snap }: { v: ReturnType<typeof viewOf>; snap: Snapshot }) {
  if (v === 'none') {
    return (
      <>
        <CardHead title="Key lights" />
        <ReasonLines head={noneTitle(snap)} text="Neither key light answered the last read. Check that both are plugged in and on the same network, then check again." />
        <button type="button" className="st-lk st-gcard-act" onClick={() => void useKeyLights.getState().refresh()}>
          <IconRefresh size={18} aria-hidden="true" />
          Check again
        </button>
      </>
    );
  }
  if (v === 'unset') {
    return (
      <>
        <CardHead title="Key lights" />
        <ReasonLines head="The key lights need their addresses." text="They are typed once in Tools, under Key lights." />
        <button type="button" className="st-lk st-gcard-act" onClick={() => { closeCard(); useToolsStore.getState().openDrawer('keylights'); }}>
          <IconSettings size={18} aria-hidden="true" />
          Open Tools
        </button>
      </>
    );
  }
  if (v !== 'live' && v !== 'one') {
    return (
      <>
        <CardHead title="Key lights" />
        <ReasonLines head="Reading the key lights." text="Their settings show once both have answered." tone="plain" />
      </>
    );
  }
  return <KeyPanel withSwitch={false} />;
}

function CardHead({ title }: { title: string }) {
  return (
    <div className="st-gcard-hd">
      <span className="st-h">{title}</span>
    </div>
  );
}

/** A home group's card: Panels has its brightness and its effect; a room group its brightness; a group that cannot be switched, why. */
function RoomCard({ studio, g, may, away }: { studio: Studio; g: Group; may: boolean; away: boolean }) {
  const why = away ? { head: 'The home app is not answering.', text: 'Nothing here can be changed until it does.' } : whyNot(studio, g, may);
  const dark = darkLine(studio, g);
  return (
    <>
      <CardHead title={g.label} />
      {why ? (
        <>
          <ReasonLines head={why.head} text={why.text} tone={needsZone(g) || away ? 'amber' : 'plain'} />
          {/* A group that does not answer keeps its slider, disabled, under the reason. */}
          {!away && !needsZone(g) && !g.reachable && g.canDim && <RoomSliderRow g={g} studio={studio} may={may} />}
          {why.head === 'View only here.' && (
            <button type="button" className="st-lk st-gcard-act" onClick={() => { closeCard(); useToolsStore.getState().openDrawer('desktoken'); }}>
              <IconSettings size={18} aria-hidden="true" />
              Desk token
            </button>
          )}
        </>
      ) : (
        <>
          {g.canDim && <RoomSliderRow g={g} studio={studio} may={may} />}
          {dark && <div className="st-line st-gcard-line">{dark}</div>}
          {g.id === 'panels' && <EffectRow studio={studio} panels={g} may={may} where="beside" />}
          {g.id !== 'panels' && g.floor ? <div className="st-line st-gcard-line">The {g.floor} percent floor keeps the room comfortable on camera.</div> : null}
        </>
      )}
    </>
  );
}

