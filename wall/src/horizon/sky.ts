import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { STAGE_WIDTH } from '../stage/fitScale';

/**
 * Sky layers: what a screen asks of the horizon while it puts something into the sky (Watch's
 * video) or stands a card in it. Default: nothing asked, and the horizon draws exactly as it always has.
 *
 * - `front`: an element to mount the horizon's front canvas in. While one is given, the horizon
 *   draws the sky on its own canvas and everything in front of the sky (the ranges, the ripple,
 *   the city, the shore, the lake and its grid) on a second, transparent canvas that it mounts in
 *   that element. The canvas is fixed to the stage (it covers it whole, whatever the element's
 *   box), so the element only sets its place in the layer order: put it after the picture and
 *   before the controls. It takes no pointer. An element no longer in the page counts as none.
 * - `boxes`: stage rectangles (design pixels) the screen covers with a picture.
 * - `clear`: stage rectangles (design pixels) of cards and blocks the moon keeps clear of.
 * - `noMoon`: no moon at all while the claim stands (a look that owns that part of the sky).
 *
 * The moon takes the first of its candidate places (`MOON_PLACES` in `cameras.ts`) whose disc is
 * `MOON_CLEAR` or more from every picture box and every keep-clear box of every claim; when none
 * is, there is no moon (`moonFor`). Claims are keyed, so two screens never undo each other;
 * `useSkyClaim` makes and releases one, `useSkyKeepClear` claims an element's own box.
 */
export type SkyBox = readonly [x: number, y: number, width: number, height: number];

export interface SkyClaim {
  front?: HTMLElement | null;
  boxes?: readonly SkyBox[];
  clear?: readonly SkyBox[];
  noMoon?: boolean;
}

interface SkyState {
  claims: Readonly<Record<string, SkyClaim>>;
}

export const useSkyStore = create<SkyState>(() => ({ claims: {} }));

/** Design pixels the moon's disc keeps from a picture's box and from every keep-clear box. */
export const MOON_CLEAR = 40;

/** True when the two box lists hold the same boxes in the same order (an absent list is an empty one). */
function sameBoxes(a: readonly SkyBox[] | undefined, b: readonly SkyBox[] | undefined): boolean {
  const n = a ? a.length : 0;
  if (n !== (b ? b.length : 0)) return false;
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) if (a![i][k] !== b![i][k]) return false;
  return true;
}

/** True when the two claims are equal in value: the same host element, the same boxes, the same no moon. */
function sameClaim(a: SkyClaim, b: SkyClaim): boolean {
  return (a.front ?? null) === (b.front ?? null) && (a.noMoon === true) === (b.noMoon === true) && sameBoxes(a.boxes, b.boxes) && sameBoxes(a.clear, b.clear);
}

/**
 * Make or replace the claim `id`. A claim equal in value to the one standing changes nothing, so
 * the claims (and the frame each change of them asks of a resting horizon) change only when a box does.
 */
export function claimSky(id: string, claim: SkyClaim): void {
  const was = useSkyStore.getState().claims[id];
  if (was && sameClaim(was, claim)) return;
  useSkyStore.setState((s) => ({ claims: { ...s.claims, [id]: claim } }));
}

/** Drop the claim `id` (nothing happens when there is none). */
export function releaseSky(id: string): void {
  const { claims } = useSkyStore.getState();
  if (!(id in claims)) return;
  const next = { ...claims };
  delete next[id];
  useSkyStore.setState({ claims: next });
}

/**
 * The element the front canvas goes in: the first claim that gives one still in the page, or null
 * (no front layer). A host taken out of the page is no host, so the main canvas draws the whole picture.
 */
export function frontHost(claims: Readonly<Record<string, SkyClaim>>): HTMLElement | null {
  for (const id in claims) {
    const el = claims[id].front;
    if (el && el.isConnected) return el;
  }
  return null;
}

/** True when the disc at (`x`, `y`) with radius `r` comes within `pad` of the box. */
function meets(x: number, y: number, r: number, pad: number, b: SkyBox): boolean {
  const nx = x < b[0] ? b[0] : x > b[0] + b[2] ? b[0] + b[2] : x;
  const ny = y < b[1] ? b[1] : y > b[1] + b[3] ? b[1] + b[3] : y;
  const dx = x - nx;
  const dy = y - ny;
  const reach = r + pad;
  return dx * dx + dy * dy < reach * reach;
}

/** True when one of `boxes` (if any) comes within `MOON_CLEAR` of the disc `m`. */
function meetsAny(m: readonly [number, number, number], boxes: readonly SkyBox[] | undefined): boolean {
  if (boxes) for (let i = 0; i < boxes.length; i++) if (meets(m[0], m[1], m[2], MOON_CLEAR, boxes[i])) return true;
  return false;
}

/**
 * The moon to draw under the claims: the first of `places` (each x, y and radius) whose disc is
 * `MOON_CLEAR` or more from every picture box and keep-clear box, or null when a claim says no
 * moon or no place is clear. The same claims always give the same place, so it changes only when
 * a box does. Allocates nothing.
 */
export function moonFor<M extends readonly [number, number, number]>(places: readonly M[], claims: Readonly<Record<string, SkyClaim>>): M | null {
  for (const id in claims) if (claims[id].noMoon) return null;
  for (let p = 0; p < places.length; p++) {
    const m = places[p];
    let clear = true;
    for (const id in claims) {
      const c = claims[id];
      if (meetsAny(m, c.boxes) || meetsAny(m, c.clear)) {
        clear = false;
        break;
      }
    }
    if (clear) return m;
  }
  return null;
}

/**
 * Hold the claim `id` while mounted and while `claim` is not null; it is released when the
 * component unmounts or `claim` becomes null. A claim equal in value to the last one changes
 * nothing. When its front host leaves the page while the claim stands, the claim is replaced at
 * once by the same claim without it (the horizon then draws on one canvas again).
 */
export function useSkyClaim(id: string, claim: SkyClaim | null): void {
  const on = claim !== null;
  const front = claim?.front ?? null;
  const boxes = claim?.boxes && claim.boxes.length ? JSON.stringify(claim.boxes) : '';
  const clear = claim?.clear && claim.clear.length ? JSON.stringify(claim.clear) : '';
  const noMoon = claim?.noMoon === true;
  useEffect(() => {
    if (!on) return;
    const c: SkyClaim = {};
    if (boxes) c.boxes = JSON.parse(boxes) as SkyBox[];
    if (clear) c.clear = JSON.parse(clear) as SkyBox[];
    if (noMoon) c.noMoon = true;
    let watch: MutationObserver | null = null;
    if (front && front.isConnected) {
      claimSky(id, { ...c, front });
      watch = new MutationObserver(() => {
        if (front.isConnected) return;
        watch?.disconnect();
        watch = null;
        claimSky(id, c);
      });
      watch.observe(front.ownerDocument, { childList: true, subtree: true });
    } else claimSky(id, c);
    return () => {
      watch?.disconnect();
      releaseSky(id);
    };
  }, [id, on, front, boxes, clear, noMoon]);
}

/** An element's box in the stage's design pixels (the stage is scaled to the window), rounded out; null when it has no size. */
export function stageBox(el: Element): SkyBox | null {
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return null;
  const stage = el.closest('.stage');
  const s = stage ? stage.getBoundingClientRect() : null;
  const k = s && s.width > 0 ? s.width / STAGE_WIDTH : 1;
  const x0 = s ? s.left : 0;
  const y0 = s ? s.top : 0;
  const x = Math.floor((r.left - x0) / k);
  const y = Math.floor((r.top - y0) / k);
  return [x, y, Math.ceil((r.right - x0) / k) - x, Math.ceil((r.bottom - y0) / k) - y];
}

/**
 * Claim the box of the element `el` (a card on Unwind) as keep-clear under `id`, read from its
 * drawn rectangle and read again whenever its size changes, so the moon never sits behind or
 * beside it. Released on unmount or when `el` is null.
 */
export function useSkyKeepClear(id: string, el: Element | null): void {
  const [box, setBox] = useState<SkyBox | null>(null);
  useEffect(() => {
    if (!el) {
      setBox(null);
      return;
    }
    const read = () => setBox(stageBox(el));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  useSkyClaim(id, el && box ? { clear: [box] } : null);
}
