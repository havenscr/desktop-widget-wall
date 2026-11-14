import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * Sky layers: what a screen asks of the horizon while it puts something into the sky (Watch's
 * video). Default: nothing asked, and the horizon draws exactly as it always has.
 *
 * - `front`: an element to mount the horizon's front canvas in. While one is given, the horizon
 *   draws the sky on its own canvas and everything in front of the sky (the ranges, the ripple,
 *   the city, the shore, the lake and its grid) on a second, transparent canvas that it mounts in
 *   that element. The canvas is fixed to the stage (it covers it whole, whatever the element's
 *   box), so the element only sets its place in the layer order: put it after the picture and
 *   before the controls. It takes no pointer.
 * - `boxes`: stage rectangles (design pixels) the screen covers with a picture. The moon is not
 *   drawn when its disc, widened by `MOON_CLEAR`, meets one of them (its light on the lake goes too).
 * - `noMoon`: no moon at all while the claim stands (a look that owns that part of the sky).
 *
 * Claims are keyed, so two screens never undo each other; `useSkyClaim` makes and releases one.
 */
export type SkyBox = readonly [x: number, y: number, width: number, height: number];

export interface SkyClaim {
  front?: HTMLElement | null;
  boxes?: readonly SkyBox[];
  noMoon?: boolean;
}

interface SkyState {
  claims: Readonly<Record<string, SkyClaim>>;
}

export const useSkyStore = create<SkyState>(() => ({ claims: {} }));

/** Design pixels the moon's disc keeps from a picture's box (and from every card on Unwind). */
export const MOON_CLEAR = 40;

/** Make or replace the claim `id`. */
export function claimSky(id: string, claim: SkyClaim): void {
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

/** The element the front canvas goes in: the first claim that gives one, or null (no front layer). */
export function frontHost(claims: Readonly<Record<string, SkyClaim>>): HTMLElement | null {
  for (const id in claims) {
    const el = claims[id].front;
    if (el) return el;
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

/**
 * The moon to draw under the claims: `moon` itself, or null when a claim says no moon or covers
 * it (its disc within `MOON_CLEAR` of a claimed box). Allocates nothing.
 */
export function moonFor<M extends readonly [number, number, number]>(moon: M, claims: Readonly<Record<string, SkyClaim>>): M | null {
  for (const id in claims) {
    const c = claims[id];
    if (c.noMoon) return null;
    const boxes = c.boxes;
    if (boxes) for (let i = 0; i < boxes.length; i++) if (meets(moon[0], moon[1], moon[2], MOON_CLEAR, boxes[i])) return null;
  }
  return moon;
}

/**
 * Hold the claim `id` while mounted and while `claim` is not null; it is released when the
 * component unmounts or `claim` becomes null. A claim equal in value to the last one changes nothing.
 */
export function useSkyClaim(id: string, claim: SkyClaim | null): void {
  const on = claim !== null;
  const front = claim?.front ?? null;
  const boxes = claim?.boxes && claim.boxes.length ? JSON.stringify(claim.boxes) : '';
  const noMoon = claim?.noMoon === true;
  useEffect(() => {
    if (!on) return;
    const c: SkyClaim = {};
    if (front) c.front = front;
    if (boxes) c.boxes = JSON.parse(boxes) as SkyBox[];
    if (noMoon) c.noMoon = true;
    claimSky(id, c);
    return () => releaseSky(id);
  }, [id, on, front, boxes, noMoon]);
}
