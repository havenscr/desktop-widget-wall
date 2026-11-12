/**
 * Watt, the electric sheep, as pixel maps. Each character is one pixel:
 * `.` empty, `w` wool (shaded light to dark by row), `f` face, `e` eye, `-` closed eye,
 * `p` pink ear, `l` leg. Facing right; the component flips it to face left.
 *
 * The concept demo's maps were not part of the material for this change, so these are
 * redrawn from the approved screenshots (wool body, dark face with one cyan eye, pink
 * ear, four thin legs). Walk keeps the demo's rule: the idle body rows plus two leg rows.
 */
export type Pose = 'idle' | 'walk' | 'sleep';

const BODY = [
  '....wwwwwwwww.....',
  '..wwwwwwwwwwww....',
  '.wwwwwwwwwwwwwp...',
  '.wwwwwwwwwwwwwffff',
  '.wwwwwwwwwwwwwffef',
  '.wwwwwwwwwwwwwffff',
  '.wwwwwwwwwwwwwwfff',
  '.wwwwwwwwwwwwww...',
  '..wwwwwwwwwwww....',
  '...wwwwwwwwww.....',
];

export const SPRITES: Readonly<Record<Pose, readonly string[]>> = {
  idle: [...BODY, '...l..l.....l..l..', '...l..l.....l..l..'],
  walk: [...BODY, '..l...l....l..l...', '..l...l....l..l...'],
  sleep: [
    '....wwwwwwww......',
    '..wwwwwwwwwwww....',
    '.wwwwwwwwwwwwwp...',
    '.wwwwwwwwwwwwwffff',
    '.wwwwwwwwwwwwwf--f',
    '.wwwwwwwwwwwwwwfff',
    '.wwwwwwwwwwwwwww..',
    '..wwwwwwwwwwwwll..',
    '...wwwwwwwwww.....',
  ],
};

export const SPRITE_COLORS: Readonly<Record<string, string>> = {
  f: '#1a1238',
  e: '#35e6ea',
  '-': '#2aa9ad',
  p: '#ff7ab8',
  l: '#8f86c9',
};

/** Colour of a pixel, or null for empty. Wool is lighter near the top (the demo's three steps). */
export function pixelColor(map: readonly string[], x: number, y: number): string | null {
  const ch = map[y]?.[x];
  if (!ch || ch === '.') return null;
  if (ch === 'w') return y < map.length * 0.45 ? '#f6f2ff' : y < map.length * 0.75 ? '#dcd3fb' : '#bfb2f0';
  return SPRITE_COLORS[ch] ?? null;
}

/** Pixel size in design pixels on the Unwind tab. */
export const SPRITE_PX = 6;
