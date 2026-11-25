import type { Rgb } from '../music/coverTint';

/** The proof of concept's ribbons: sky height, hue, speed, strength; `quiet` ribbons show more as the music calms. */
export interface Ribbon {
  y: number;
  h: number;
  hue: Rgb;
  warm: Rgb;
  speed: number;
  kick: number;
  phase: number;
  alpha: number;
  quiet: boolean;
}

export const RIBBONS: readonly Ribbon[] = [
  { y: 70, h: 150, hue: [47, 224, 208], warm: [255, 176, 96], speed: 0.05, kick: 1, phase: 0, alpha: 0.55, quiet: false },
  { y: 120, h: 170, hue: [140, 90, 255], warm: [255, 96, 140], speed: 0.035, kick: 0.7, phase: 2.1, alpha: 0.55, quiet: false },
  { y: 40, h: 120, hue: [255, 70, 150], warm: [255, 120, 70], speed: 0.06, kick: 1.4, phase: 4.2, alpha: 0.5, quiet: false },
  { y: 150, h: 130, hue: [70, 235, 150], warm: [255, 210, 110], speed: 0.028, kick: 0.55, phase: 1.3, alpha: 0.42, quiet: true },
  { y: 14, h: 110, hue: [70, 120, 255], warm: [255, 150, 120], speed: 0.045, kick: 1.15, phase: 5.4, alpha: 0.4, quiet: true },
];

/** How far the cover's colour pulls a ribbon (0 to 1). */
export const COVER_PULL = 0.4;

const mixc = (a: Rgb, b: Rgb, f: number): Rgb => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

/**
 * A ribbon's colour at one end of the palette (`warm` false: cool, quiet music; true: warm, loud),
 * pulled toward the cover's colour (`tint`, null when no cover is known).
 */
export function ribbonColour(r: Ribbon, warm: boolean, tint: Rgb | null): Rgb {
  const base = warm ? r.warm : r.hue;
  return tint ? mixc(base, tint, COVER_PULL) : base;
}

/** Colour channels rounded and joined, to tell when sprites need baking again. */
export const colourKey = (c: Rgb | null): string => (c ? `${Math.round(c[0] / 12)},${Math.round(c[1] / 12)},${Math.round(c[2] / 12)}` : 'none');
