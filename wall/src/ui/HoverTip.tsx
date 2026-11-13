import { useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react';
import { create } from 'zustand';

/** How long the pointer rests on something before its card shows (calm, never flickering). */
export const TIP_DELAY_MS = 250;
/** The stage's design size: the card stays inside it. */
const STAGE_W = 2560;
const EDGE = 12;

interface TipState {
  content: ReactNode | null;
  /** The anchor's box in design pixels, inside the stage. */
  box: { x: number; y: number; w: number; h: number } | null;
}

const useTipStore = create<TipState>(() => ({ content: null, box: null }));
let timer: ReturnType<typeof setTimeout> | null = null;

/** The element's box in the stage's design pixels (the stage is scaled to the window). */
function designBox(el: Element): TipState['box'] {
  const r = el.getBoundingClientRect();
  const stage = el.closest('.stage');
  if (!stage) return { x: r.left, y: r.top, w: r.width, h: r.height };
  const s = stage.getBoundingClientRect();
  const scale = s.width > 0 ? s.width / STAGE_W : 1;
  return { x: (r.left - s.left) / scale, y: (r.top - s.top) / scale, w: r.width / scale, h: r.height / scale };
}

function show(el: Element, content: ReactNode | (() => ReactNode), delay: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    useTipStore.setState({ content: typeof content === 'function' ? content() : content, box: designBox(el) });
  }, delay);
}

/** Hide any card at once (also cancels one about to show). */
export function hideTip(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (useTipStore.getState().content !== null) useTipStore.setState({ content: null, box: null });
}

/**
 * Hover (and keyboard focus) handlers that show a small card above an element after a
 * short rest. `content` may be a function, so it is built only when shown. One card at a
 * time, drawn by `HoverTipLayer`.
 */
export function tip(content: ReactNode | (() => ReactNode)) {
  return {
    onMouseEnter: (e: MouseEvent) => show(e.currentTarget, content, TIP_DELAY_MS),
    onMouseLeave: hideTip,
    onFocus: (e: FocusEvent) => show(e.currentTarget, content, 0),
    onBlur: hideTip,
    onMouseDown: hideTip,
  };
}

/** Tests only: forget any card. */
export function resetTip(): void {
  hideTip();
}

/**
 * The one hover card, inside the stage so it scales with it: centred above its anchor (below
 * when there is no room above), kept inside the stage's width. Pointer events pass through.
 */
export function HoverTipLayer() {
  const { content, box } = useTipStore();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!content || !box || !ref.current) {
      setPos(null);
      return;
    }
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    const left = Math.min(STAGE_W - EDGE - w, Math.max(EDGE, box.x + box.w / 2 - w / 2));
    const above = box.y - h - 10;
    setPos({ left, top: above >= EDGE ? above : box.y + box.h + 10 });
  }, [content, box]);
  if (!content || !box) return null;
  return (
    <div ref={ref} className="hover-tip" role="tooltip" style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}>
      {content}
    </div>
  );
}
