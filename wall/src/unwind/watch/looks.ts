import type { WatchKind } from './links';

/**
 * How video sits in the scene, in the approved page's order (A to D). The drawing of each is in
 * `Watch.tsx` and the Watch rules of `unwind.css`; the settings sheet, the Look button's cycle
 * and the stored-value check all read this list.
 */
export const LOOKS = [
  { id: 'feather', name: 'Feathered', hint: 'The video melts into the night sky, its edges soft.' },
  { id: 'sky', name: 'Whole sky', hint: 'The video fills the sky behind everything; a normal video is cropped top and bottom.' },
  { id: 'sun', name: 'The sun', hint: 'The video plays inside the sun on the horizon; only its middle shows.' },
  { id: 'drivein', name: 'Drive-in', hint: 'A drive-in screen on the horizon; nothing is cropped.' },
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

/** The look after `id`, wrapping round. */
export function nextLook(id: LookId): LookId {
  const i = LOOKS.findIndex((l) => l.id === id);
  return LOOKS[(i + 1) % LOOKS.length].id;
}

/** The Look button: step the look this kind plays in (all of them in one look mode). */
export function stepLook(s: LookSettings, kind: WatchKind): LookSettings {
  const next = nextLook(lookFor(s, kind));
  return s.mode === 'one' ? { ...s, all: next } : { ...s, [groupOf(kind)]: next };
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
 * The drive-in screen in wall pixels, frame included (the approved page's 27 by 15.2 strip
 * units): it stands on two posts on the horizon (wall y 505) and covers the horizon's moon
 * (wall 1730, 112, radius 44) whole, so the moon never peeks over its edge. The Watch rules in
 * `unwind.css` place it at these numbers less Unwind's offset (124, 20); fit-check compares.
 */
export const DRIVE_IN_SCREEN: Readonly<WallRect> = Object.freeze({ x: 1210, y: 60, w: 691, h: 389 });
