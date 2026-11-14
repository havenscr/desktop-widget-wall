import type { WatchKind } from './links';

/**
 * How video sits in the scene, in the approved page's order (A to D). The drawing of each is in
 * `Watch.tsx` and the Watch rules of `unwind.css`; the settings sheet, the Look button's cycle
 * and the stored-value check all read this list.
 */
export const LOOKS = [
  { id: 'feather', name: 'Feathered', hint: 'The video melts into the night sky, its edges soft.' },
  { id: 'sky', name: 'Whole sky', hint: 'The whole video stands behind the mountains; its edges fade into the sky.' },
  { id: 'sun', name: 'The sun', hint: 'The video plays inside the sun on the horizon; only its middle shows.' },
  { id: 'drivein', name: 'Drive-in', hint: 'A drive-in screen on a steel tower; its marquee says when it is paused. Nothing is cropped.' },
  { id: 'holo', name: 'Hologram', hint: 'The whole picture floats on a tilted pane of light over a small emitter; nothing is cropped.' },
] as const;
export type LookId = (typeof LOOKS)[number]['id'];

/** The three groups a look can be set for, with their names in the settings sheet. */
export const LOOK_GROUPS = [
  { id: 'video', name: 'Videos and playlists' },
  { id: 'live', name: 'Live streams' },
  { id: 'twitch', name: 'Twitch' },
] as const;
export type LookGroup = (typeof LOOK_GROUPS)[number]['id'];

export interface LookSettings {
  /** `one`: one look for everything; `kind`: one per group. */
  mode: 'one' | 'kind';
  all: LookId;
  video: LookId;
  live: LookId;
  twitch: LookId;
}

/** The approved drawing: the drive-in for everything; per kind, videos melt, live streams fill the sky and Twitch sits on the screen. */
export const DEFAULT_LOOKS: LookSettings = { mode: 'one', all: 'drivein', video: 'feather', live: 'sky', twitch: 'drivein' };

export const LOOKS_KEY = 'wall2-watch-look';

export function isLook(v: unknown): v is LookId {
  return typeof v === 'string' && LOOKS.some((l) => l.id === v);
}

export function lookName(id: LookId): string {
  return LOOKS.find((l) => l.id === id)?.name ?? id;
}

export function groupOf(kind: WatchKind): LookGroup {
  return kind === 'playlist' ? 'video' : kind;
}

/** Stored settings, each field checked; anything unknown falls back to the default. */
export function parseLooks(raw: string | null): LookSettings {
  if (!raw || raw.length > 1000) return { ...DEFAULT_LOOKS };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_LOOKS };
  }
  if (!v || typeof v !== 'object') return { ...DEFAULT_LOOKS };
  const o = v as Record<string, unknown>;
  const pick = (k: keyof Omit<LookSettings, 'mode'>): LookId => (isLook(o[k]) ? (o[k] as LookId) : DEFAULT_LOOKS[k]);
  return { mode: o.mode === 'kind' ? 'kind' : 'one', all: pick('all'), video: pick('video'), live: pick('live'), twitch: pick('twitch') };
}

export function loadLooks(): LookSettings {
  try {
    return parseLooks(localStorage.getItem(LOOKS_KEY));
  } catch {
    return { ...DEFAULT_LOOKS };
  }
}

export function saveLooks(s: LookSettings): void {
  try {
    localStorage.setItem(LOOKS_KEY, JSON.stringify(s));
  } catch {
    /* the look is a convenience */
  }
}

/** The look an item of this kind plays in. */
export function lookFor(s: LookSettings, kind: WatchKind): LookId {
  return s.mode === 'one' ? s.all : s[groupOf(kind)];
}

/**
 * The Look switch: set the look this kind plays in. With one look for everything it sets that
 * look; with a look per kind it sets the look of this kind's group only.
 */
export function pickLook(s: LookSettings, kind: WatchKind, look: LookId): LookSettings {
  return s.mode === 'one' ? { ...s, all: look } : { ...s, [groupOf(kind)]: look };
}

/** The group name the Look switch sets, for its hover tip; null with one look for everything. */
export function lookTargetName(s: LookSettings, kind: WatchKind): string | null {
  if (s.mode === 'one') return null;
  return LOOK_GROUPS.find((g) => g.id === groupOf(kind))?.name ?? null;
}

/** A rectangle in wall pixels (the 2560 by 720 strip). */
export interface WallRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The drive-in's video box in wall pixels: exactly 16:9, the picture itself (the Screen tower
 * frame is drawn round it and never over it, see `towerFrame.ts`). It stands 34 px right of and 6 px
 * above the old screen, so the sitting sheep fits between the Look switch (which ends at x 1084)
 * and the frame, and the frame has 73 px of structure between the picture's foot and the ground.
 * The Watch rules in `unwind.css` place it at these numbers less Unwind's offset (124, 20);
 * fit-check compares.
 */
export const DRIVE_IN_SCREEN: Readonly<WallRect> = Object.freeze({ x: 1244, y: 54, w: 672, h: 378 });

/** The horizon line in wall pixels (Unwind's camera): the drive-in's footings stand on it. */
export const DRIVE_IN_GROUND = 505;

/**
 * The Hologram's pane before its tilt (wall pixels): the whole 16:9 picture, 736 by 414. After
 * the tilt (`perspective(2400px) rotateY(-7deg) rotateX(1.2deg)`, origin 50% 60%) it covers about
 * wall x 1219 to 1950 and y 38 to 459.
 */
export const HOLO_PANE: Readonly<WallRect> = Object.freeze({ x: 1210, y: 42, w: 736, h: 414 });

/**
 * sky layers: the picture's box in wall pixels for each look (the drawn picture, its frame or
 * disc, not its glow), as the Watch rules in `unwind.css` place it; fit-check compares. The
 * horizon's moon keeps 40 px clear of it: it takes another of its places, or none (`horizon/sky.ts`).
 * - feather: the feathered picture, its soft edges included.
 * - sky: the whole 16:9 picture, never cropped: as tall as the sky allows (its top 16 px under the
 *   top of the strip, its foot 11 px under the horizon line, so only the land hides its lower edge),
 *   between the left block (which ends at x 1084; 22 px of sky between them) and the cards (from x 2000).
 * - sun: the disc at the approved page's place (centre x 1331, its foot 29 px over the horizon), 461 px across.
 * - drivein: the screen (`DRIVE_IN_SCREEN`).
 * - holo: the tilted pane's reach (the pane and its tilt, hairlines excluded).
 */
export const LOOK_BOXES: Readonly<Record<LookId, Readonly<WallRect>>> = Object.freeze({
  feather: Object.freeze({ x: 1150, y: 50, w: 810, h: 455 }),
  sky: Object.freeze({ x: 1106, y: 16, w: 889, h: 500 }),
  sun: Object.freeze({ x: 1101, y: 15, w: 461, h: 461 }),
  drivein: DRIVE_IN_SCREEN,
  holo: Object.freeze({ x: 1210, y: 38, w: 740, h: 421 }),
});

/**
 * The whole sky's soft edge: how far, in px, the picture's top, left and right edges fade into the
 * sky (the stage carries it as `--w-sky-soft`; the mask is in `unwind.css`). The fade is taken from
 * the picture's own edge, so the box never changes; the middle 649 by 380 is untouched at 120.
 * A later change will make it a setting of this look.
 */
export const SKY_SOFT_EDGE = 120;

/**
 * sky layers: the looks whose picture sits in the sky behind the land, so the horizon draws the
 * ranges, the land and the grid on its front canvas in front of it (approved B and C). The
 * feathered picture stays in front of the mountains (the owner's choice), its lower edge fading
 * out before the horizon line, and the drive-in screen stands in front of the ranges (approved
 * D), so neither asks for a front layer.
 */
export function behindTheLand(look: LookId): boolean {
  return look === 'sky' || look === 'sun';
}

/**
 * sky layers: whether the picture is behind the land right now. While the player waits for a
 * click to start, the sun comes forward so the click reaches it; the whole sky stays behind (the
 * wall lets the pointer through to it, see the whole sky's rules in `unwind.css`, and the front
 * canvas takes no pointer).
 */
export function layeredNow(look: LookId, needsClick: boolean): boolean {
  return behindTheLand(look) && (look === 'sky' || !needsClick);
}

/** sky layers: the looks that own the part of the sky the moon is in, so no moon is drawn while they show (the sun, the drive-in). */
export function ownsTheMoonSky(look: LookId): boolean {
  return look === 'sun' || look === 'drivein';
}
