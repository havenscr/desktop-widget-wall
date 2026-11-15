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

/** The inline custom property a chip or dot reads (`--c`), or none for a tag with no colour. */
export function tagVars(tag: Pick<TaskTag, 'color'>): CSSProperties | undefined {
  const hue = tagHue(tag.color);
  return hue ? ({ '--c': rgbOf(hue) } as CSSProperties) : undefined;
}

export const DOT_PX = 28;
export const TAG_GAP_PX = 6;
/** A chip never grows past this; a longer label ends in an ellipsis (its tip has the whole text). */
export const CHIP_MAX_PX = 170;
/** Under this much room for the title, every tag of the row becomes a dot. */
export const MIN_TITLE_PX = 180;
/** Room before the tags (the row's gap). */
const LEAD_PX = 12;

/** A chip's width: its 9 px lead, 16 px glyph, 6 px gap, the label (about 9 px a letter at 600 16 px), 11 px tail and 2 px edge. */
export function chipWidth(label: string): number {
  return Math.min(CHIP_MAX_PX, 44 + Math.round([...label].length * 9));
}

/** `chip`: the first tag by name and the rest as dots. `dots`: every tag a dot, when the chip would leave the title under 180 px. */
export function tagLayout(tags: readonly TaskTag[], room: number): 'chip' | 'dots' {
  if (tags.length === 0) return 'dots';
  const width = LEAD_PX + chipWidth(tags[0]!.label) + (tags.length - 1) * (DOT_PX + TAG_GAP_PX);
  return room - width < MIN_TITLE_PX ? 'dots' : 'chip';
}
