import { DRIVE_IN_SCREEN, DRIVE_IN_GROUND } from './looks';

/**
 * The drive-in's frame, the "Screen tower": steel surround with a coping and one neon edge line, a
 * Warren truss under the screen, two lattice towers on footings, raking side stays, a marquee
 * board, a soft ground shadow and the legs mirrored faintly in the floor. It is drawn in wall
 * pixels (a 2560 by 720 scene) round the video's box and never over it: every fill round the
 * picture is a ring with the box cut out (even-odd), and the one blurred part (the neon's glow) is
 * clipped to the same ring. Nothing animates but the marquee's words (`DriveInFrame.tsx`).
 *
 * The shapes are the approved drawing's, with every bar's end moved onto the bar it meets: the
 * frame is built from named segments (`MEMBERS`), the stays and chords meet, the truss web starts
 * and ends on the stays, and `towerGeometry.test.ts` checks every joint.
 */

const V = DRIVE_IN_SCREEN;
const L = V.x;
const T = V.y;
const R = V.x + V.w;
const B = V.y + V.h;
export const FRAME_CX = V.x + V.w / 2;
const G = DRIVE_IN_GROUND;
const CX = FRAME_CX;

/** The marquee board's box (wall pixels): 392 by 30, hung under the truss, centred on the picture. */
export const MARQUEE = Object.freeze({ x: CX - 196, y: B + 9, w: 392, h: 30 });
/** The baseline of the marquee's words. */
export const MARQUEE_TEXT_Y = MARQUEE.y + 21;

/** What the marquee says: the name, and the name with what is on. */
export const MARQUEE_NAME = 'WATT’S DRIVE-IN';
export const MARQUEE_PLAYING = `${MARQUEE_NAME} · NOW SHOWING`;
export const MARQUEE_PAUSED = `${MARQUEE_NAME} · INTERMISSION`;

const ID = 'wt';
const CYAN = '#35e6ea';
const PINK = '#ff3d9a';
const RIM = 'rgba(190,172,255,.5)';
const RIM2 = 'rgba(190,172,255,.28)';
const LACE = '#5d50a0';
const MEMBER = '#2b2152';

const n = (v: number) => +v.toFixed(2);

/** A rectangle path (clockwise) with an optional corner radius. */
function rr(x: number, y: number, w: number, h: number, r = 0): string {
  if (r <= 0) return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`;
  return `M${n(x + r)} ${n(y)}h${n(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${n(h - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${r}h${n(-(w - 2 * r))}a${r} ${r} 0 0 1 ${-r} ${-r}v${n(-(h - 2 * r))}a${r} ${r} 0 0 1 ${r} ${-r}z`;
}
/** The video box grown by d on every side. */
const grow = (d: number, r = 0) => rr(L - d, T - d, V.w + 2 * d, V.h + 2 * d, r);
/** A ring: the outer shape with the video box cut out (even-odd), so nothing can cover the picture. */
const ring = (outer: string, fill: string) => `<path d="${outer}${rr(L, T, V.w, V.h)}" fill="${fill}" fill-rule="evenodd"/>`;

const DEFS = `<defs>
  <linearGradient id="${ID}steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d2352"/><stop offset=".5" stop-color="#1c1438"/><stop offset="1" stop-color="#120c28"/></linearGradient>
  <linearGradient id="${ID}neon" gradientUnits="userSpaceOnUse" x1="${L - 20}" y1="0" x2="${R + 20}" y2="0"><stop offset="0" stop-color="#5cc4ff"/><stop offset=".5" stop-color="${CYAN}"/><stop offset="1" stop-color="${PINK}"/></linearGradient>
  <linearGradient id="${ID}fade" gradientUnits="userSpaceOnUse" x1="0" y1="${G}" x2="0" y2="${G + 46}"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <mask id="${ID}refl" maskUnits="userSpaceOnUse" x="0" y="${G}" width="2560" height="60"><rect x="0" y="${G}" width="2560" height="60" fill="url(#${ID}fade)"/></mask>
  <radialGradient id="${ID}shadow"><stop offset="0" stop-color="#03020b" stop-opacity=".75"/><stop offset="1" stop-color="#03020b" stop-opacity="0"/></radialGradient>
  <filter id="${ID}glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>
  <clipPath id="${ID}clip"><path clip-rule="evenodd" d="${rr(0, 0, 2560, 720)}${rr(L, T, V.w, V.h)}"/></clipPath>
</defs>`;

/** Whatever stands on the ground, mirrored into the floor and faded (the floor is glossy). */
const mirror = (inner: string, op = 0.5) => `<g mask="url(#${ID}refl)" opacity="${op}"><g transform="translate(0 ${2 * G}) scale(1 -1)">${inner}</g></g>`;

/** One structural member: a straight bar between two points (wall pixels), named, with its stroke. */
export interface Member {
  name: string;
  /** Members of one assembly (a stay, a tower, the truss web) share a group; a joint must meet another group. */
  group: string;
  kind: 'main' | 'lace' | 'brace';
  /** Stroke width in pixels. */
  w: number;
  a: readonly [number, number];
  b: readonly [number, number];
}
/** A footing on the ground line: its box (x0, y0 .. x1, y1; the base is the ground). */
export interface Footing {
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const tl = L + 104;
const tr = R - 104; // tower centres
const Y0 = B + 12; // the truss's upper chord (its lower edge is the surround's lower edge)
const Y1 = B + 30; // the truss's lower chord
const STAY_TOP = B - 96;
const STAY_RUN = 26;
const BAYS = 28;

/** The surround's outer box (the fascia): 14 px out from the picture. */
export const SURROUND = Object.freeze({ x0: L - 14, y0: T - 14, x1: R + 14, y1: B + 14 });
/** The ground line's y. */
export const GROUND_Y = G;

/** Side s is -1 for the left, 1 for the right. A point on the stay of side s at height y. */
const stayAt = (s: number, y: number): [number, number] => [(s < 0 ? L - 12 : R + 12) + (s * STAY_RUN * (y - STAY_TOP)) / (G - STAY_TOP), y];
/** A point on the surround's outer side edge, side s, at height y. */
const edgeAt = (s: number, y: number): [number, number] => [s < 0 ? L - 14 : R + 14, y];

function buildMembers(): Member[] {
  const out: Member[] = [];
  const add = (name: string, group: string, kind: Member['kind'], w: number, a: readonly [number, number], b: readonly [number, number]) => out.push({ name, group, kind, w, a, b });
  const side = (s: number) => (s < 0 ? 'L' : 'R');
  // Knee braces: each runs from its tower's inner leg up to the lower chord.
  for (const s of [-1, 1]) {
    const cx = s < 0 ? tl : tr;
    add(`knee-${side(s)}`, `knee-${side(s)}`, 'brace', 2.5, [cx - s * 9, Y1 + 34], [cx - s * 62, Y1]);
  }
  // The truss under the screen: a Warren web that starts and ends on the stays, then the two chords
  // that run from one stay to the other.
  const xl = stayAt(-1, Y1)[0];
  const xr = stayAt(1, Y1)[0];
  for (let i = 1; i <= BAYS; i++) {
    const x0 = xl + ((xr - xl) * (i - 1)) / BAYS;
    const x1 = xl + ((xr - xl) * i) / BAYS;
    add(`web-${i}`, 'web', 'lace', 1.5, [x0, i % 2 ? Y1 : Y0], [x1, i % 2 ? Y0 : Y1]);
  }
  add('chord-upper', 'chord-upper', 'main', 4, stayAt(-1, Y0), stayAt(1, Y0));
  add('chord-lower', 'chord-lower', 'main', 4, stayAt(-1, Y1), stayAt(1, Y1));
  // The raking side stays: from the surround's side down to a footing on the ground line, with
  // zigzag lacing between the stay and the surround's side edge.
  const laceRows: [number, number][] = [[B - 60, 0], [B - 40, 1], [B - 20, 0], [B, 1], [Y0, 0]]; // [height, 1 when the node is on the surround]
  for (const s of [-1, 1]) {
    const k = side(s);
    const node = ([y, onEdge]: [number, number]) => (onEdge ? edgeAt(s, y) : stayAt(s, y));
    for (let i = 1; i < laceRows.length; i++) add(`stay-lace-${k}${i}`, `stay-lace-${k}`, 'lace', 1.5, node(laceRows[i - 1]), node(laceRows[i]));
    add(`stay-${k}`, `stay-${k}`, 'main', 4, stayAt(s, STAY_TOP), stayAt(s, G));
  }
  // The two lattice towers: an outer leg battered 9 px outward and a straight inner leg, with
  // zigzag lacing (which starts on the outer leg, so the towers mirror each other).
  for (const s of [-1, 1]) {
    const k = side(s);
    const cx = s < 0 ? tl : tr;
    const outer = (t: number): [number, number] => [cx + s * (9 + 9 * t), Y1 + (G - Y1) * t];
    const inner = (t: number): [number, number] => [cx - s * 9, Y1 + (G - Y1) * t];
    const at = (t: number, isOuter: boolean) => (isOuter ? outer(t) : inner(t));
    for (let i = 1; i <= 4; i++) add(`tower-lace-${k}${i}`, `tower-lace-${k}`, 'lace', 1.5, at((i - 1) / 4, i % 2 === 1), at(i / 4, i % 2 === 0));
    for (let i = 1; i < 4; i++) add(`tower-tie-${k}${i}`, `tower-lace-${k}`, 'lace', 1.5, outer(i / 4), inner(i / 4));
    add(`tower-leg-${k}1`, `tower-leg-${k}1`, 'main', 5, outer(0), outer(1));
    add(`tower-leg-${k}2`, `tower-leg-${k}2`, 'main', 5, inner(0), inner(1));
  }
  return out;
}

/** The frame's bars, as named straight segments in wall pixels (the markup is drawn from these). */
export const MEMBERS: readonly Member[] = Object.freeze(buildMembers());

const footing = (name: string, cx: number, w: number): Footing => ({ name, x0: cx - w / 2, y0: G - 6, x1: cx + w / 2, y1: G });
/** The four footings: one under each tower, one under each stay. */
export const FOOTINGS: readonly Footing[] = Object.freeze([footing('foot-tower-L', tl - 4, 44), footing('foot-tower-R', tr + 4, 44), footing('foot-stay-L', L - 38, 22), footing('foot-stay-R', R + 38, 22)]);

const STROKE = { main: MEMBER, lace: LACE, brace: '#3a2f66' } as const;

/** The members as strokes: consecutive members of one style share a path. */
function strokes(list: readonly Member[]): string {
  let out = '';
  let cur: Member | null = null;
  let d = '';
  const flush = () => {
    if (cur) out += `<path d="${d}" stroke="${STROKE[cur.kind]}" stroke-width="${cur.w}" fill="none" stroke-linecap="${cur.kind === 'main' ? 'butt' : 'round'}"/>`;
    d = '';
  };
  for (const m of list) {
    if (!cur || cur.kind !== m.kind || cur.w !== m.w) {
      flush();
      cur = m;
    }
    d += `M${n(m.a[0])} ${n(m.a[1])}L${n(m.b[0])} ${n(m.b[1])}`;
  }
  flush();
  return out;
}
const byName = (name: string) => MEMBERS.find((m) => m.name === name)!;

/** The whole frame as SVG markup (everything but the marquee's words), in wall pixels. */
function build(): string {
  const rim = (names: string[]) =>
    names
      .map((nm) => {
        const m = byName(nm);
        return `<path d="M${n(m.a[0] - 1.5)} ${n(m.a[1])}L${n(m.b[0] - 1.5)} ${n(m.b[1])}" stroke="${RIM2}" stroke-width="1" fill="none"/>`;
      })
      .join('');
  const up = byName('chord-upper');
  const part = (prefix: string) => strokes(MEMBERS.filter((m) => m.group.startsWith(prefix)));
  // Back to front: braces, towers, the truss (its chords cover the towers' tops), then the stays
  // (they cover the chords' ends, so the joint reads as one fixing).
  const structure = `${part('knee')}${part('tower')}${rim(['tower-leg-L1', 'tower-leg-L2', 'tower-leg-R1', 'tower-leg-R2'])}${part('web')}${part('chord')}<path d="M${n(up.a[0])} ${n(up.a[1] - 2)}H${n(up.b[0])}" stroke="${RIM2}" stroke-width="1"/>${part('stay')}${rim(['stay-L', 'stay-R'])}`;
  const foot = (f: Footing) => {
    const w = f.x1 - f.x0;
    return `<path d="M${f.x0} ${G}l4 -6h${w - 8}l4 6z" fill="#2a2050"/><path d="M${f.x0 + 4} ${G - 6}h${w - 8}" stroke="${RIM}" stroke-width="1"/>`;
  };
  const feet = FOOTINGS.map(foot).join('');
  // The marquee board hangs from the truss between the towers (its words are drawn by the component).
  const m = MARQUEE;
  // `w-sign` is the one handle the Sign setting hides (the board and, in `DriveInFrame.tsx`, its words).
  const board = `<g class="w-sign"><rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" rx="4" fill="#100a24" stroke="${LACE}" stroke-width="1.5"/>
    <rect x="${m.x + 4}" y="${m.y + 4}" width="${m.w - 8}" height="${m.h - 8}" rx="2" fill="none" stroke="rgba(255,176,84,.42)" stroke-width="1"/></g>`;
  // The screen's surround: a steel fascia, a coping on top, black masking next to the picture, one neon edge line.
  const fascia = `${ring(grow(14, 4), `url(#${ID}steel)`)}
    ${ring(grow(4), '#06040f')}
    <path d="${grow(4.5)}" fill="none" stroke="${RIM2}" stroke-width="1"/>
    <rect x="${L - 20}" y="${T - 20}" width="${V.w + 40}" height="7" rx="2" fill="#2d2352"/><path d="M${L - 19} ${T - 19.5}H${R + 19}" stroke="${RIM}" stroke-width="1"/>
    <path d="${grow(9.5, 2)}" fill="none" stroke="url(#${ID}neon)" stroke-width="5" opacity=".5" filter="url(#${ID}glow)" clip-path="url(#${ID}clip)"/>
    <path d="${grow(9.5, 2)}" fill="none" stroke="url(#${ID}neon)" stroke-width="1.6"/>`;
  const shadow = `<ellipse cx="${n(CX)}" cy="${G + 1}" rx="430" ry="9" fill="url(#${ID}shadow)"/>`;
  return `${DEFS}${shadow}${mirror(structure)}${structure}${feet}${board}${fascia}`;
}

/** The frame's markup, made once. */
export const TOWER_SVG: string = build();

/**
 * The neon line's path (the outline the Travelling light follows, `DriveInFrame.tsx`): the video box
 * grown by 9.5 px, corner radius 2, the same path the frame's neon stroke uses.
 */
export const NEON_PATH: string = grow(9.5, 2);
