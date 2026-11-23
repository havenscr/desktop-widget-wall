/**
 * Watt, the electric sheep, as pixel maps. Each character is one pixel:
 * `.` empty, `w` wool (shaded light to dark by row), `f` face, `e` eye, `-` closed eye,
 * `p` pink ear, `l` leg. Facing right; the component flips it to face left.
 *
 * Idle and sleep are the concept's own maps, copied exactly. Walk keeps the concept's rule: the
 * idle body rows plus two leg rows. The other poses are drawn the same way, at the same size; props
 * and the little things (heart, clover, amber mark) use their own colour letters (`PROP_COLORS`).
 */
export type Pose = 'idle' | 'walk' | 'sleep' | 'read' | 'look' | 'yawn' | 'stretch' | 'eat' | 'held' | 'held2' | 'land' | 'sit' | 'dizzy' | 'alert' | 'hop' | 'spin1' | 'spin2' | 'lie' | 'watch' | 'watchEar' | 'front';

/** Every pose, for the tests and the sprite sheet. */
export const POSES: readonly Pose[] = ['idle', 'walk', 'sleep', 'read', 'look', 'yawn', 'stretch', 'eat', 'held', 'held2', 'land', 'sit', 'dizzy', 'alert', 'hop', 'spin1', 'spin2', 'lie', 'watch', 'watchEar', 'front'];

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

/** The look pose's raised head, and the sit pose's round bottom, for the watching poses. */
const WATCH_HEAD: readonly string[] = [
  '....wwwwwww...pf..',
  '..wwwwwwwwwww.fff.',
  '.wwwwwwwwwwwwwfeff',
  '.wwwwwwwwwwwwwffff',
  'wwwwwwwwwwwwwwfff.',
  'wwwwwwwwwwwwwwwf..',
  'wwwwwwwwwwwwwwww..',
];
const SIT_BOTTOM: readonly string[] = ['.wwwwwwwwwwwwww...', 'wwwwwwwwwwwwwwwl..', 'wwwwwwwwwwwwwwwl..', '.lll.........ll...'];

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
  // Carried by the wool: eyes wide, legs dangling and leaning one way (held) or the other (held2).
  held: [
    ...IDLE.slice(0, 3),
    '.wwwwwwwwwwwwwfeff',
    'wwwwwwwwwwwwwwfeef',
    ...IDLE.slice(5, 10),
    '...l..l...l..l....',
    '..l..l...l..l.....',
  ],
  held2: [
    ...IDLE.slice(0, 3),
    '.wwwwwwwwwwwwwfeff',
    'wwwwwwwwwwwwwwfeef',
    ...IDLE.slice(5, 10),
    '...l..l...l..l....',
    '....l..l...l..l...',
  ],
  // The moment of landing: flattened wool, legs splayed, eyes shut.
  land: [
    ...IDLE.slice(1, 4),
    'wwwwwwwwwwwwwwf-ff',
    ...IDLE.slice(5, 10),
    '.l...l.....l...l..',
    '.l...l.....l...l..',
  ],
  // Sitting: round bottom on the ground, paws tucked, no legs standing.
  sit: [
    ...IDLE.slice(0, 7),
    '.wwwwwwwwwwwwww...',
    'wwwwwwwwwwwwwwwl..',
    'wwwwwwwwwwwwwwwl..',
    '.lll.........ll...',
  ],
  // Swirly eyes (a checker of cyan and dark) after being shaken.
  dizzy: [...IDLE.slice(0, 3), '.wwwwwwwwwwwwwfefe', 'wwwwwwwwwwwwwwffef', 'wwwwwwwwwwwwwwfefe', ...IDLE.slice(6)],
  // Ears up and eyes wide: he has noticed the pointer.
  alert: ['....wwwwwww...p...', '..wwwwwwwwwww.p...', ...IDLE.slice(2, 3), '.wwwwwwwwwwwwwfeff', 'wwwwwwwwwwwwwwfeef', ...IDLE.slice(5)],
  // In the air: body high, legs tucked close, a clear gap and a small shadow line on the ground below, eyes squeezed shut with joy.
  hop: [...IDLE.slice(0, 4), 'wwwwwwwwwwwwwwf-ff', ...IDLE.slice(5, 9), '...ll......ll.....', '..................', '...ssssssssssss...'],
  // Turning on the spot: the wool ball seen from the front (face), then from behind (no face).
  spin1: [
    '.....wwwwwwww.....',
    '...wwwwwwwwwwww...',
    '..wwwwwwwwwwwwww..',
    '..wwwwpffffpwwww..',
    '..wwwwwfeffefwww..',
    '..wwwwwffffffwww..',
    '..wwwwwwffffwwww..',
    '..wwwwwwwwwwwwww..',
    '...wwwwwwwwwwww...',
    '....wwwwwwwwww....',
    '.....l......l.....',
    '.....l......l.....',
  ],
  spin2: [
    '.....wwwwwwww.....',
    '...wwwwwwwwwwww...',
    '..wwwwwwwwwwwwww..',
    '..wwwwwwwwwwwwww..',
    '..wwwwwwwwwwwwww..',
    '..wwwwwwwwwwwwww..',
    '..wwwwwwwpwwwwww..',
    '..wwwwwwwpwwwwww..',
    '...wwwwwwwwwwww...',
    '....wwwwwwwwww....',
    '.....l......l.....',
    '.....l......l.....',
  ],
  // Lying down asleep: head on his paws.
  lie: [
    '....wwwwwww.......',
    '..wwwwwwwwwww.....',
    '.wwwwwwwwwwwww....',
    '.wwwwwwwwwwwwwpf..',
    'wwwwwwwwwwwwwwffff',
    'wwwwwwwwwwwwwwf-ff',
    'wwwwwwwwwwwwwwwfff',
    '.wwwwwwwwwwwwwlll.',
  ],
  // Watching the drive-in: sitting (the sit's round bottom and tucked paws) with the head raised
  // to the screen (the look pose's head). `watchEar` is the same with his ear laid back for a
  // moment, one of his small signs of life.
  watch: [...WATCH_HEAD, ...SIT_BOTTOM],
  watchEar: ['....wwwwwww....f..', '..wwwwwwwwwwwpfff.', ...WATCH_HEAD.slice(2), ...SIT_BOTTOM],
  // Seated, turned round to the viewer (the spin's front view on the sit's tucked paws): the
  // one look back while the video is paused.
  front: [
    '.....wwwwwwww.....',
    '...wwwwwwwwwwww...',
    '..wwwwwwwwwwwwww..',
    '..wwwwpffffpwwww..',
    '..wwwwwfeffefwww..',
    '..wwwwwffffffwww..',
    '..wwwwwwffffwwww..',
    '..wwwwwwwwwwwwww..',
    '.wwwwwwwwwwwwwwww.',
    '.wwwwwwwwwwwwwwww.',
    '..lll........lll..',
  ],
};

/** The same poses with the eyes shut for one frame (a blink): every open eye pixel closed. */
export const BLINKS: Readonly<Record<Pose, readonly string[]>> = Object.fromEntries(
  POSES.map((p) => [p, SPRITES[p].map((row) => row.replace(/e/g, '-'))]),
) as unknown as Record<Pose, readonly string[]>;

/**
 * The wool he is held by: two pixels pulled up from his back while he is carried, at `TUFT_AT`
 * (sprite pixels from his top left, facing right).
 */
export const TUFT: readonly string[] = ['.W', 'WW'];
export const TUFT_AT: readonly [number, number] = [6, -2];
/** A puff of dust either side of his feet when he lands or hops down. */
export const DUST: readonly string[] = ['.d.', 'ddd'];
/** His shadow on the ground under where he will land while he is carried and falling. */
export const SHADOW: readonly string[] = ['..SSSSSSSSSS..', 'SSSSSSSSSSSSSS'];

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
  held: [14, 2],
  held2: [14, 2],
  land: [14, 1],
  sit: [14, 2],
  dizzy: [14, 2],
  alert: [14, 2],
  hop: [14, 2],
  spin1: [8, 3],
  spin2: [8, 3],
  lie: [14, 3],
  watch: [14, 0],
  // The head stays put while the ear lies back: props on the head do not move.
  watchEar: [14, 0],
  front: [8, 3],
};

/** Things she wears or holds. `book` to `nightcap` follow the day; the rest are cosmetics. */
export type Prop = 'book' | 'headphones' | 'sunglasses' | 'scarf' | 'nightcap' | 'bow' | 'star' | 'cape' | 'bolt' | 'flower' | 'backpack' | 'wings';
export const PROPS: readonly Prop[] = ['book', 'headphones', 'sunglasses', 'scarf', 'nightcap', 'bow', 'star', 'cape', 'bolt', 'flower', 'backpack', 'wings'];

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

const STAR_MAP: readonly string[] = ['..s..', '.sts.', 'sttts', '.sts.', '.s.s.'];

export const PROP_SPRITES: Readonly<Record<Prop, PropSprite>> = {
  book: { map: ['bBBb', 'bBBb', 'bbbb'], dx: 2, dy: 3, anchor: 'ear' },
  // One big cup over the ear, the band over the top of the head and down in front of the face.
  headphones: { map: ['..kk.', 'ccc.k', 'cCc..', 'ccc..'], dx: -2, dy: -1, anchor: 'ear' },
  sunglasses: { map: ['ggghg'], dx: -1, dy: 2, anchor: 'ear' },
  scarf: { map: ['rRrRr', '.r...', '.R...'], dx: -2, dy: 4, anchor: 'ear' },
  nightcap: { map: ['....nN', '..nnn.', '.nnnn.'], dx: -1, dy: -3, anchor: 'ear' },
  // Tied on his tail, at the rear end; `dx`, `dy` are the standing pose's place, `BODY_AT.bow` the rest.
  bow: { map: ['xx.xx', 'xxQxx', '.x.x.'], dx: -1, dy: 3, anchor: 'body' },
  // A five-point star patch on his wool; `dx`, `dy` are the standing pose's place, `STAR_AT` the rest.
  star: { map: STAR_MAP, dx: 5, dy: 3, anchor: 'body' },
  cape: { map: ['qqqqq.', 'qQqqqq', 'qqQqq.', 'qqqQ..', 'qq....'], dx: -1, dy: 3, anchor: 'body' },
  // Each of these has one fixed place per pose (`BODY_AT`), whatever day prop is on him.
  bolt: { map: ['..ss', '.ss.', 'ssss', '.ss.', 'ss..'], dx: 5, dy: 3, anchor: 'body' },
  flower: { map: ['.v.', 'vtv', '.vo'], dx: 3, dy: -1, anchor: 'body' },
  backpack: { map: ['.TTT.', 'TbbbT', 'TbBbT', 'TTTTT'], dx: 3, dy: 2, anchor: 'body' },
  wings: { map: ['BB....', 'kkB...', '.kkkB.', '..kkkk'], dx: 2, dy: -2, anchor: 'body' },
};

/**
 * Where the star patch goes on each pose, its top left in sprite pixels from the sheep's top left.
 * Every one of its pixels lies on wool of that pose and clear of what can be worn with it
 * (headphones, scarf, sunglasses, nightcap, book); the sprite tests check it. Poses whose body is
 * shorter (sleeping, lying, landing, hopping) take it one row higher; the front and back views, which
 * show no flank, take it on the nearest wool, left of the face.
 */
export const STAR_AT: Readonly<Record<Pose, readonly [number, number]>> = {
  idle: [5, 3],
  walk: [5, 3],
  sleep: [5, 2],
  read: [5, 3],
  look: [5, 3],
  yawn: [5, 3],
  stretch: [5, 3],
  eat: [5, 3],
  held: [5, 3],
  held2: [5, 3],
  land: [5, 2],
  sit: [5, 3],
  dizzy: [5, 3],
  alert: [5, 3],
  hop: [5, 2],
  spin1: [2, 3],
  spin2: [2, 3],
  lie: [5, 2],
  watch: [5, 3],
  watchEar: [5, 3],
  front: [2, 3],
};

/** A place for every pose: `base`, with `over` for the poses that differ. */
const ALL = (base: readonly [number, number], over: Partial<Record<Pose, readonly [number, number]>> = {}): Readonly<Record<Pose, readonly [number, number]>> =>
  Object.fromEntries(POSES.map((q) => [q, over[q] ?? base])) as unknown as Record<Pose, readonly [number, number]>;
const BOW_AT = ALL([-1, 3], { sleep: [-1, 2], land: [-1, 2], hop: [-1, 2], lie: [-1, 2] });
const BOLT_AT = ALL([5, 3], { sleep: [5, 2], land: [5, 2], hop: [5, 2], lie: [5, 2], spin1: [2, 3], spin2: [2, 3], front: [2, 3] });
const FLOWER_AT = ALL([3, -1], { land: [3, -2] });
const BACKPACK_AT = ALL([3, 2], { sleep: [3, 1], land: [3, 1], hop: [3, 1], lie: [3, 1], spin1: [2, 3], spin2: [2, 3], front: [2, 3] });
const WINGS_AT = ALL([2, -2]);

/** Poses seen from the front or the back: a side-on cup on the ear cannot be drawn on them. */
export const NO_HEADPHONES: ReadonlySet<Pose> = new Set<Pose>(['spin1', 'spin2', 'front']);

/** The small plus sparkle (the happy reaction's glitter), not the star he wears. */
export const SPARKLE: readonly string[] = ['.s.', 'sss', '.s.'];

/**
 * Where each body-anchored cosmetic goes on each pose: its top left in sprite pixels from the sheep's
 * top left. Day props never move it. Every pixel of it lies on wool of that pose, or outside the sheep
 * (a wing tip, a flower, the bow's tails), and clear of what can be worn with it (headphones, scarf,
 * sunglasses, nightcap, book); the sprite tests check both. Poses whose body is shorter (sleeping,
 * lying, landing, hopping) take it one row higher; the front and back views, which show no flank,
 * take it on the nearest wool.
 */
export const BODY_AT: Readonly<Record<'bow' | 'bolt' | 'flower' | 'backpack' | 'wings', Readonly<Record<Pose, readonly [number, number]>>>> = {
  bow: BOW_AT,
  bolt: BOLT_AT,
  flower: FLOWER_AT,
  backpack: BACKPACK_AT,
  wings: WINGS_AT,
};

/**
 * Top left of a prop on `pose`, in sprite pixels from the sheep's top left (may be negative). `worn` is the day
 * prop on him; no cosmetic depends on it, and only the ear-anchored day props are placed from the ear.
 */
export function propOrigin(prop: Prop, pose: Pose, worn: Prop | null = null): [number, number] {
  void worn;
  if (prop === 'star') return [STAR_AT[pose][0], STAR_AT[pose][1]];
  if (prop === 'bow' || prop === 'bolt' || prop === 'flower' || prop === 'backpack' || prop === 'wings') return [BODY_AT[prop][pose][0], BODY_AT[prop][pose][1]];
  const s = PROP_SPRITES[prop];
  if (s.anchor === 'body') return [s.dx, s.dy];
  const [ex, ey] = EAR[pose];
  return [ex + s.dx, ey + s.dy];
}

/** Sprite pixels an ear-anchored prop moves with the ear's row while rows are shifted (a shake frame, the wind's lean); body props stay. */
export function earShift(prop: Prop, pose: Pose, rows: RowShift): number {
  if (rows === 0 || PROP_SPRITES[prop].anchor !== 'ear') return 0;
  return ROW_DX[rows][EAR[pose][1]] ?? 0;
}

/** Little things of her own: a heart when petted, a clover on the ground, the amber mark. */
export const HEART: readonly string[] = ['.v.v.', 'vvvvv', '.vvv.', '..v..'];
export const CLOVER: readonly string[] = ['.o.o.', 'ooooo', '.ooo.', '..O..', '..O..'];
export const MARK: readonly string[] = ['aa', 'aa', 'aa', '..', 'aa'];
/** The dusk firefly: one small sprite, softer than his wool. */
export const FIREFLY: readonly string[] = ['.y.', 'yYy', '.y.'];
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
  r: '#ff3d9a',
  R: '#ffc24d',
  n: '#6b5fd0',
  N: '#f6f2ff',
  x: '#ff7ab8',
  s: '#ffc24d',
  t: '#fff0b8',
  C: '#ff7ab8',
  q: '#ff3d9a',
  Q: '#c42a78',
  T: '#2aa9ad',
  v: '#ff3d9a',
  o: '#5df2b6',
  O: '#2fb184',
  a: '#ffc24d',
  W: '#f6f2ff',
  d: '#bfb2f0',
  S: '#0a061e',
  y: '#a8c850',
  Y: '#e4f08f',
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
  s: '#4d3f98',
};

/** Colour of a pixel, or null for empty. Wool is lighter near the top (the demo's three steps). */
export function pixelColor(map: readonly string[], x: number, y: number): string | null {
  const ch = map[y]?.[x];
  if (!ch || ch === '.') return null;
  if (ch === 'w') return y < map.length * 0.45 ? '#f6f2ff' : y < map.length * 0.75 ? '#dcd3fb' : '#bfb2f0';
  return SPRITE_COLORS[ch] ?? null;
}

/**
 * Damp wool, one step darker than dry at every row zone (`#a79bdc` is the one new colour), and the
 * strands that stick out of it, one step darker again (`#9388cf` is the second new colour, used by
 * the lowest zone only).
 */
export const WET_WOOL: readonly string[] = ['#dcd3fb', '#bfb2f0', '#a79bdc'];
export const WET_STRAND: readonly string[] = ['#bfb2f0', '#a79bdc', '#9388cf'];

/** Wet strands, as (column, row) in a pose facing right; a strand is drawn only where the pose has wool at that cell. */
export const STRANDS: readonly (readonly [number, number])[] = [
  [3, 2], [3, 3], [8, 1], [8, 2], [11, 3], [11, 4], [2, 6], [2, 7], [6, 7], [6, 8], [10, 6], [10, 7], [12, 8],
];
const STRAND_KEYS: ReadonlySet<number> = new Set(STRANDS.map(([x, y]) => y * 64 + x));

/** How the wool looks: dry, damp (rain), or fluffy and light for a while after a shake (the dry colours, no strands). */
export type Wool = 'dry' | 'wet' | 'fluffy';

/** The row zone of a wool pixel: 0 the top 45 percent of the rows, 1 to 75 percent, 2 below. */
function zoneOf(map: readonly string[], y: number): 0 | 1 | 2 {
  return y < map.length * 0.45 ? 0 : y < map.length * 0.75 ? 1 : 2;
}

/** Colour of a pixel of the damp sheep (wet wool, with its strands), or null for empty. */
export function pixelColorWet(map: readonly string[], x: number, y: number): string | null {
  const ch = map[y]?.[x];
  if (!ch || ch === '.') return null;
  if (ch === 'w') return (STRAND_KEYS.has(y * 64 + x) ? WET_STRAND : WET_WOOL)[zoneOf(map, y)];
  return SPRITE_COLORS[ch] ?? null;
}

/**
 * Rows moved sideways, in the sprite's own direction (it faces right here; the element flips it).
 * 0 none; 1 to 4 the four frames of a shake (upper wool and lower wool one pixel apart, legs still,
 * alternating); 5 the wind's lean when he faces right and 6 when he faces left (the two top rows one
 * pixel downwind, which is the screen's right).
 */
export type RowShift = 0 | 1 | 2 | 3 | 4 | 5 | 6;
const shake = (s: number): readonly number[] => [s, s, s, s, s, -s, -s, -s, -s, -s, 0, 0];
export const ROW_DX: Readonly<Record<RowShift, readonly number[]>> = {
  0: [],
  1: shake(-1),
  2: shake(1),
  3: shake(-1),
  4: shake(1),
  5: [1, 1],
  6: [-1, -1],
};

/** Pixel size in design pixels on the Unwind tab. */
export const SPRITE_PX = 6;
