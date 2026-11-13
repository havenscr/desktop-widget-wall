import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react';
import { create } from 'zustand';

/** How long the pointer rests on something before its card shows (calm, never flickering). */
export const TIP_DELAY_MS = 250;
/** A shown card is redrawn this often, so a countdown in it stays right while hovered. */
export const TIP_REFRESH_MS = 15_000;
/** How often a shown card checks that its anchor is still on the page. */
export const TIP_ANCHOR_CHECK_MS = 500;
/** After a click, the focus that follows it does not reopen the card for this long. */
const FOCUS_AFTER_CLICK_MS = 600;
/** The stage's design size: the card stays inside it. */
const STAGE_W = 2560;
const EDGE = 12;

type Content = ReactNode | (() => ReactNode);

interface TipState {
  render: (() => ReactNode) | null;
  /** The anchor's box in design pixels, inside the stage. */
  box: { x: number; y: number; w: number; h: number } | null;
  anchor: Element | null;
  /** A pinned card (opened by a click) takes the pointer and stays until dismissed. */
  pinned: boolean;
}

const empty: TipState = { render: null, box: null, anchor: null, pinned: false };
const useTipStore = create<TipState>(() => empty);
let timer: ReturnType<typeof setTimeout> | null = null;
let quietFocusUntil = 0;

/** The element's box in the stage's design pixels (the stage is scaled to the window). */
function designBox(el: Element): TipState['box'] {
  const r = el.getBoundingClientRect();
  const stage = el.closest('.stage');
  if (!stage) return { x: r.left, y: r.top, w: r.width, h: r.height };
  const s = stage.getBoundingClientRect();
  const scale = s.width > 0 ? s.width / STAGE_W : 1;
  return { x: (r.left - s.left) / scale, y: (r.top - s.top) / scale, w: r.width / scale, h: r.height / scale };
}

const asRender = (content: Content): (() => ReactNode) => (typeof content === 'function' ? (content as () => ReactNode) : () => content);

function show(el: Element, content: Content, delay: number): void {
  if (useTipStore.getState().pinned) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (!el.isConnected || useTipStore.getState().pinned) return;
    useTipStore.setState({ render: asRender(content), box: designBox(el), anchor: el, pinned: false });
  }, delay);
}

/**
 * Hide the card at once (also cancels one about to show). A pinned card stays unless
 * `force` is set (a click elsewhere, Escape, or its anchor leaving the page).
 */
export function hideTip(force = false): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const st = useTipStore.getState();
  if (st.pinned && !force) return;
  if (st.render !== null) useTipStore.setState(empty);
}

/** Show a card that takes the pointer (a list to pick from) under `el` until dismissed. */
export function pinTip(el: Element, content: Content): void {
  if (timer) clearTimeout(timer);
  timer = null;
  useTipStore.setState({ render: asRender(content), box: designBox(el), anchor: el, pinned: true });
}

/**
 * Hover (and keyboard focus) handlers that show a small card above an element after a
 * short rest. `content` may be a function, so it is built when shown (and redrawn while
 * it shows). One card at a time, drawn by `HoverTipLayer`. The focus that follows a click
 * does not reopen the card the click just closed.
 */
export function tip(content: Content) {
  return {
    onMouseEnter: (e: MouseEvent) => show(e.currentTarget, content, TIP_DELAY_MS),
    onMouseLeave: () => hideTip(),
    onFocus: (e: FocusEvent) => {
      if (Date.now() < quietFocusUntil) return;
      show(e.currentTarget, content, 0);
    },
    onBlur: () => hideTip(),
    onMouseDown: () => {
      quietFocusUntil = Date.now() + FOCUS_AFTER_CLICK_MS;
      hideTip();
    },
  };
}

/** Tests only: forget any card. */
export function resetTip(): void {
  quietFocusUntil = 0;
  hideTip(true);
}

/**
 * The one hover card, inside the stage so it scales with it: centred above its anchor (below
 * when there is no room above), kept inside the stage's width. A hover card lets the pointer
 * through; a pinned one takes it and closes on a click elsewhere or Escape. Either closes
 * when its anchor leaves the page (a card that went away on a poll), and its content is
 * redrawn every 15 seconds while it shows.
 */
export function HoverTipLayer() {
  const { render, box, anchor, pinned } = useTipStore();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [, setTick] = useState(0);
  useLayoutEffect(() => {
    if (!render || !box || !ref.current) {
      setPos(null);
      return;
    }
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    const left = Math.min(STAGE_W - EDGE - w, Math.max(EDGE, box.x + box.w / 2 - w / 2));
    const above = box.y - h - 10;
    setPos({ left, top: above >= EDGE ? above : box.y + box.h + 10 });
  }, [render, box]);
  useEffect(() => {
    if (!render) return;
    const check = setInterval(() => {
      if (anchor && !anchor.isConnected) hideTip(true);
    }, TIP_ANCHOR_CHECK_MS);
    const refresh = setInterval(() => setTick((n) => n + 1), TIP_REFRESH_MS);
    return () => {
      clearInterval(check);
      clearInterval(refresh);
    };
  }, [render, anchor]);
  useEffect(() => {
    if (!pinned) return;
    const down = (e: Event) => {
      const t = e.target as Node | null;
      if (t && (ref.current?.contains(t) || anchor?.contains(t))) return;
      hideTip(true);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideTip(true);
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [pinned, anchor]);
  if (!render || !box) return null;
  return (
    <div
      ref={ref}
      className={`hover-tip${pinned ? ' pinned' : ''}`}
      role={pinned ? 'dialog' : 'tooltip'}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
    >
      {render()}
    </div>
  );
}
