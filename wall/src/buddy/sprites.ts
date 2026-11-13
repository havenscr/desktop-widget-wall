/**
 * Watt, the electric sheep, as pixel maps. Each character is one pixel:
 * `.` empty, `w` wool (shaded light to dark by row), `f` face, `e` eye, `-` closed eye,
 * `p` pink ear, `l` leg. Facing right; the component flips it to face left.
 *
 * Idle and sleep are the concept's own maps, copied exactly. Walk keeps the concept's rule: the
 * idle body rows plus two leg rows. The other poses are drawn the same way, at the same size; props
 * and the little things (heart, clover, amber mark) use their own colour letters (`PROP_COLORS`).
 */
export type Pose = 'idle' | 'walk' | 'sleep' | 'read' | 'look' | 'yawn' | 'stretch' | 'eat';

/** Every pose, for the tests and the sprite sheet. */
export const POSES: readonly Pose[] = ['idle', 'walk', 'sleep', 'read', 'look', 'yawn', 'stretch', 'eat'];

const LEGS = ['...l..l...l..l....', '...l..l...l..l....'];

const IDLE: readonly string[] = [
  '....wwwwwww.......',
  '..wwwwwwwwwww.....',
  '.wwwwwwwwwwwwwpf..',
  '.wwwwwwwwwwwwwffff',
  'wwwwwwwwwwwwwwfeff',
  'wwwwwwwwwwwwwwffff',
  'wwwwwwwwwwwwwwwff.',
  '.wwwwwwwwwwwwww...',
  '.wwwwwwwwwwwww....',
  '..wwwwwwwwwww.....',
  '...l..l...l..l....',
  '...l..l...l..l....',
];

export const SPRITES: Readonly<Record<Pose, readonly string[]>> = {
  idle: IDLE,
  walk: [...IDLE.slice(0, 10), '..l...l....l..l...', '..l...l....l..l...'],
  sleep: [
    '....wwwwwww.......',
    '..wwwwwwwwwww.....',
    '.wwwwwwwwwwwww....',
    '.wwwwwwwwwwwwwpf..',
    'wwwwwwwwwwwwwwffff',
    'wwwwwwwwwwwwwwf-ff',
    'wwwwwwwwwwwwwwwfff',
    '.wwwwwwwwwwwwwww..',
  ],
  // Head lowered, eyes down, for the tiny book.
  read: [
    '....wwwwwww.......',
    '..wwwwwwwwwww.....',
    '.wwwwwwwwwwwww....',
    '.wwwwwwwwwwwwwpf..',
    'wwwwwwwwwwwwwwffff',
    'wwwwwwwwwwwwwwffff',
    'wwwwwwwwwwwwwwfeff',
    '.wwwwwwwwwwwwwfff.',
    '.wwwwwwwwwwwww....',
    ...IDLE.slice(9),
  ],
  // Head up: the moon, the clock, the agents.
  look: [
    '....wwwwwww...pf..',
    '..wwwwwwwwwww.fff.',
    '.wwwwwwwwwwwwwfeff',
    '.wwwwwwwwwwwwwffff',
    'wwwwwwwwwwwwwwfff.',
    'wwwwwwwwwwwwwwwf..',
    'wwwwwwwwwwwwwwww..',
    ...IDLE.slice(7),
  ],
  // Eyes shut, mouth open.
  yawn: [...IDLE.slice(0, 4), 'wwwwwwwwwwwwwwf-ff', 'wwwwwwwwwwwwwwffpf', 'wwwwwwwwwwwwwwwfp.', ...IDLE.slice(7)],
  // Head low, legs wide, eyes shut.
  stretch: [
    '....wwwwwww.......',
    '..wwwwwwwwwww.....',
    '.wwwwwwwwwwwww....',
    '.wwwwwwwwwwwwwpf..',
    'wwwwwwwwwwwwwwffff',
    'wwwwwwwwwwwwwwf-ff',
    'wwwwwwwwwwwwwwffff',
    '.wwwwwwwwwwwwwwff.',
    '.wwwwwwwwwwwww....',
    '..wwwwwwwwwww.....',
    '..l...l....l...l..',
    '.l....l....l....l.',
  ],
  // Head down in the grass.
  eat: [
    '....wwwwwww.......',
    '..wwwwwwwwwww.....',
    '.wwwwwwwwwwwww....',
    '.wwwwwwwwwwwwww...',
    'wwwwwwwwwwwwwwpf..',
    'wwwwwwwwwwwwwwfff.',
    'wwwwwwwwwwwwwwf-ff',
    '.wwwwwwwwwwwwwffff',
    '.wwwwwwwwwwwwwffff',
    '..wwwwwwwwwww.fff.',
    ...LEGS,
  ],
};

/** The ear pixel (column, row) of each pose: props that sit on the head are placed from it. */
export const EAR: Readonly<Record<Pose, readonly [number, number]>> = {
  idle: [14, 2],
  walk: [14, 2],
  sleep: [14, 3],
  read: [14, 3],
  look: [14, 0],
  yawn: [14, 2],
  stretch: [14, 3],
  eat: [14, 4],
};

/** Things she wears or holds. `book` to `nightcap` follow the day; `bow`, `star` and `cape` are cosmetics. */
export type Prop = 'book' | 'headphones' | 'sunglasses' | 'umbrella' | 'scarf' | 'nightcap' | 'bow' | 'star' | 'cape';
export const PROPS: readonly Prop[] = ['book', 'headphones', 'sunglasses', 'umbrella', 'scarf', 'nightcap', 'bow', 'star', 'cape'];

/**
 * A prop's map and where it goes, in sprite pixels: from the pose's ear pixel (`ear`) or from the
 * sprite's top left (`body`). Facing right, like the sheep; it flips with her.
 */
export interface PropSprite {
  map: readonly string[];
  dx: number;
  dy: number;
  anchor: 'ear' | 'body';
}

export const PROP_SPRITES: Readonly<Record<Prop, PropSprite>> = {
  book: { map: ['bBBb', 'bBBb', 'bbbb'], dx: 2, dy: 3, anchor: 'ear' },
  headphones: { map: ['.kkkk.', 'k....k', 'c....c', 'c....c'], dx: -1, dy: -2, anchor: 'ear' },
  sunglasses: { map: ['ggghg'], dx: -1, dy: 2, anchor: 'ear' },
  umbrella: { map: ['..UUUUU..', '.uuuuuuu.', 'uuuuuuuuu', '....i....', '....i....', '....i....', '....ii...'], dx: -5, dy: -4, anchor: 'ear' },
  scarf: { map: ['rRrRr', '.r...', '.R...'], dx: -2, dy: 4, anchor: 'ear' },
  nightcap: { map: ['....nN', '..nnn.', '.nnnn.'], dx: -1, dy: -3, anchor: 'ear' },
  bow: { map: ['xx.xx', '.xxx.'], dx: -3, dy: -1, anchor: 'ear' },
  star: { map: ['.s.', 'sss', '.s.'], dx: 1, dy: -4, anchor: 'ear' },
  cape: { map: ['qqqqq.', 'qQqqqq', 'qqQqq.', 'qqqQ..', 'qq....'], dx: -1, dy: 3, anchor: 'body' },
};

/** Top left of a prop on `pose`, in sprite pixels from the sheep's top left (may be negative). */
export function propOrigin(prop: Prop, pose: Pose): [number, number] {
  const s = PROP_SPRITES[prop];
  if (s.anchor === 'body') return [s.dx, s.dy];
  const [ex, ey] = EAR[pose];
  return [ex + s.dx, ey + s.dy];
}

/** Little things of her own: a heart when petted, a clover on the ground, the amber mark. */
export const HEART: readonly string[] = ['.v.v.', 'vvvvv', '.vvv.', '..v..'];
export const CLOVER: readonly string[] = ['.o.o.', 'ooooo', '.ooo.', '..O..', '..O..'];
export const MARK: readonly string[] = ['aa', 'aa', 'aa', '..', 'aa'];
/** Pixel size of the heart, the clover and the mark, design pixels. */
export const SMALL_PX = 3;

/** Colours of the props and the little things. */
export const PROP_COLORS: Readonly<Record<string, string>> = {
  b: '#35e6ea',
  B: '#f6f2ff',
  k: '#35e6ea',
  c: '#ff3d9a',
  g: '#05030f',
  h: '#35e6ea',
  u: '#ff3d9a',
  U: '#ff7ab8',
  i: '#8f86c9',
  r: '#ff3d9a',
  R: '#ffc24d',
  n: '#6b5fd0',
  N: '#f6f2ff',
  x: '#ff7ab8',
  s: '#ffc24d',
  q: '#ff3d9a',
  Q: '#c42a78',
  v: '#ff3d9a',
  o: '#5df2b6',
  O: '#2fb184',
  a: '#ffc24d',
};

/** Colour of a prop or little thing pixel, or null for empty. */
export function propColor(map: readonly string[], x: number, y: number): string | null {
  const ch = map[y]?.[x];
  if (!ch || ch === '.') return null;
  return PROP_COLORS[ch] ?? null;
}

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
