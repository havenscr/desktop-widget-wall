import type { CSSProperties } from 'react';
import type { TaskTag } from './model';

/**
 * The task app's eleven colour names as the app draws them: eight hues, with khaki, orange
 * and red as aliases of lime, brown and pink. Text and glyph are this colour on a 14 percent
 * wash of it; each hue measures 4.5 or more as 16 px text there (`TaskTags.test.tsx` holds it on every background a row has),
 * so none needed lightening.
 */
export const TAG_HUES: Record<string, string> = {
  teal: '#6cb6e8',
  blue: '#7f9cff',
  green: '#5fc98b',
  lime: '#b4cc5c',
  khaki: '#b4cc5c',
  pink: '#f08ac0',
  red: '#f08ac0',
  magenta: '#d389e6',
  brown: '#c49a74',
  orange: '#c49a74',
  slate: '#9fb0c6',
};

/** The hue for a colour name, or null (no colour, or a name the app does not use). */
export function tagHue(color: string | null | undefined): string | null {
  return color && Object.hasOwn(TAG_HUES, color) ? TAG_HUES[color]! : null;
}

/** `r,g,b` of a `#rrggbb` colour. */
export function rgbOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** The inline custom property a pill reads (`--c`), or none for a tag with no colour. */
export function tagVars(tag: Pick<TaskTag, 'color'>): CSSProperties | undefined {
  const hue = tagHue(tag.color);
  return hue ? ({ '--c': rgbOf(hue) } as CSSProperties) : undefined;
}

/** A tag's round pill, in pixels, and the gap between pills (`work.css` `.t-dot` and `.t-tags`). */
export const DOT_PX = 26;
export const TAG_GAP_PX = 4;
