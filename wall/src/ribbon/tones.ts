/**
 * Outlook category colours on the ribbon and the Day drawer.
 *
 * The native side sends one of 25 fixed tokens (`preset0` to `preset24`), never a colour
 * string. This module holds the shade for each token and works out, for each state of a
 * chip or tile, a tinted fill, an edge and a text colour whose contrast against that fill
 * is at least `FLOOR` on every dark ground the strip can sit on.
 *
 * Preset to colour names: Microsoft Graph v1.0, "outlookCategory resource type", table
 * "Pre-set constant / Color mapped to in Outlook" (Preset0 Red, Preset1 Orange, Preset2
 * Brown, Preset3 Yellow, Preset4 Green, Preset5 Teal, Preset6 Olive, Preset7 Blue, Preset8
 * Purple, Preset9 Cranberry, Preset10 Steel, Preset11 DarkSteel, Preset12 Gray, Preset13
 * DarkGray, Preset14 Black, Preset15 DarkRed, Preset16 DarkOrange, Preset17 DarkBrown,
 * Preset18 DarkYellow, Preset19 DarkGreen, Preset20 DarkTeal, Preset21 DarkOlive,
 * Preset22 DarkBlue, Preset23 DarkPurple, Preset24 DarkCranberry).
 */

export type Rgb = readonly [number, number, number];

/** The colour name each token stands for, in token order. */
export const TONE_NAMES = [
  'Red', 'Orange', 'Brown', 'Yellow', 'Green', 'Teal', 'Olive', 'Blue', 'Purple', 'Cranberry', 'Steel', 'DarkSteel', 'Gray',
  'DarkGray', 'Black', 'DarkRed', 'DarkOrange', 'DarkBrown', 'DarkYellow', 'DarkGreen', 'DarkTeal', 'DarkOlive', 'DarkBlue', 'DarkPurple', 'DarkCranberry',
] as const;

/** The shade drawn for each token. Black and the greys are lifted so a tint still shows on the dark ground. */
const BASE: readonly Rgb[] = [
  [229, 72, 77], [245, 129, 43], [168, 116, 74], [242, 194, 48], [63, 185, 80], [31, 181, 166], [154, 162, 46], [77, 141, 245], [179, 95, 224],
  [214, 69, 122], [127, 155, 181], [95, 122, 147], [163, 163, 181], [125, 125, 143], [85, 85, 106], [184, 54, 60], [201, 99, 26], [138, 90, 51],
  [184, 146, 31], [47, 138, 63], [23, 133, 122], [119, 128, 31], [59, 111, 198], [138, 63, 192], [168, 51, 95],
];

export type ToneToken = `preset${number}`;

const TOKEN_SHAPE = /^preset(?:[0-9]|1[0-9]|2[0-4])$/;

/** True for exactly `preset0` to `preset24`. Anything else the native side might send is ignored. */
export function isToneToken(v: unknown): v is ToneToken {
  return typeof v === 'string' && TOKEN_SHAPE.test(v);
}

export const TONE_TOKENS: readonly ToneToken[] = TONE_NAMES.map((_, i) => `preset${i}` as ToneToken);

/** A category as the native side sends it: a cleaned name and a token. */
export interface EventCategory {
  name: string;
  tone: ToneToken;
}

/** The longest category name shown, matching the native cap. */
export const MAX_CATEGORY_CHARS = 64;

/** The category of an event answer, or null when it is missing or not in the expected shape. */
export function readCategory(v: unknown): EventCategory | null {
  if (typeof v !== 'object' || v === null) return null;
  const { name, tone } = v as { name?: unknown; tone?: unknown };
  if (!isToneToken(tone) || typeof name !== 'string') return null;
  const clean = name.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '').trim().slice(0, MAX_CATEGORY_CHARS);
  return clean === '' ? null : { name: clean, tone };
}

export type ToneState = 'past' | 'now' | 'next';

/** The lift ribbon.css gives a hovered, openable event (`filter: brightness`); its contrast is tested at this factor. */
export const HOVER_BRIGHTNESS = 1.15;

/** The least contrast any text on a coloured chip or tile may have against its own fill. */
export const FLOOR = 4.5;

/**
 * The darkest and lightest ground a chip can sit on, and the drawer's. The ribbon is the
 * night sky at 40 percent under a dark wash; its lightest stop (the sunrise glow, at the
 * chip row) composites to about (78, 48, 43), so the lightest ground is taken a little above that.
 */
export const GROUNDS: Record<'ribbon' | 'drawer', readonly Rgb[]> = {
  ribbon: [[9, 7, 30], [84, 52, 48]],
  drawer: [[14, 11, 34]],
};

const ALPHA: Record<ToneState, { fill: number; edge: number }> = {
  next: { fill: 0.22, edge: 0.55 },
  now: { fill: 0.32, edge: 0.8 },
  // Dimmed by a quieter fill, edge and text, never by fading the whole chip: fading drops the text below the floor.
  past: { fill: 0.1, edge: 0.3 },
};

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** `over` painted at `alpha` on `ground`. */
export function composite(over: Rgb, alpha: number, ground: Rgb): Rgb {
  return mix(ground, over, alpha);
}

function lum(c: Rgb): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

/** WCAG contrast ratio of two colours. */
export function ratio(a: Rgb, b: Rgb): number {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/** The least contrast of `text` against the tone's fill, over every ground in `grounds`. */
function worst(text: Rgb, base: Rgb, fillAlpha: number, grounds: readonly Rgb[]): number {
  return Math.min(...grounds.map((g) => ratio(text, composite(base, fillAlpha, g))));
}

/**
 * The text colour for a fill: the dimmest tint of the tone (walking up toward white) that
 * clears `target` on every ground; failing that, a dark tint (walking down toward black).
 * `start` is how far toward white the walk begins.
 */
function pickText(base: Rgb, fillAlpha: number, grounds: readonly Rgb[], target: number, start: Rgb): Rgb {
  for (let i = 0; i <= 20; i++) {
    const c = mix(start, WHITE, i / 20);
    if (worst(c, base, fillAlpha, grounds) >= target) return c;
  }
  for (let i = 0; i <= 20; i++) {
    const c = mix(mix(base, BLACK, 0.55), BLACK, i / 20);
    if (worst(c, base, fillAlpha, grounds) >= target) return c;
  }
  return worst(WHITE, base, fillAlpha, grounds) >= worst(BLACK, base, fillAlpha, grounds) ? WHITE : BLACK;
}

const css = (c: Rgb, a = 1) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;

export interface ToneStyle {
  fill: string;
  edge: string;
  text: string;
  /** The same colours as numbers, for the tests. */
  rgb: { base: Rgb; fillAlpha: number; text: Rgb };
}

const cache = new Map<string, ToneStyle>();

/**
 * Fill, edge and text for a token in a state, on the ribbon or in the drawer. Text is a
 * light tint of the tone (the past state's is the dimmest that still clears the floor).
 */
export function toneStyle(token: ToneToken, state: ToneState, where: 'ribbon' | 'drawer'): ToneStyle {
  const key = `${token}|${state}|${where}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const base = BASE[Number(token.slice(6))];
  const { fill, edge } = ALPHA[state];
  const grounds = GROUNDS[where];
  // A little margin over the floor, so rounding to whole colour values never takes it under.
  const target = FLOOR + 0.3;
  const text =
    state === 'past'
      ? pickText(base, fill, grounds, target, mix(base, grounds[0], 0.45))
      : // Next and now read at 7 to 1 where the fill allows it, else at the floor.
        worst(pickText(base, fill, grounds, 7, mix(base, WHITE, 0.7)), base, fill, grounds) >= 7
        ? pickText(base, fill, grounds, 7, mix(base, WHITE, 0.7))
        : pickText(base, fill, grounds, target, mix(base, WHITE, 0.7));
  const style: ToneStyle = { fill: css(base, fill), edge: css(base, edge), text: css(text), rgb: { base, fillAlpha: fill, text } };
  cache.set(key, style);
  return style;
}

/** Inline custom properties for an element carrying `data-tone`. */
export function toneVars(token: ToneToken, state: ToneState, where: 'ribbon' | 'drawer'): Record<string, string> {
  const s = toneStyle(token, state, where);
  return { '--tone-fill': s.fill, '--tone-edge': s.edge, '--tone-text': s.text };
}

/** The category line for a hover card and an accessible name. */
export function categoryLine(name: string): string {
  return `Category: ${name}`;
}
