import { DRIVE_IN_SCREEN, DRIVE_IN_GROUND } from './looks';

/**
 * The drive-in's frame, the "Screen tower": steel surround with a coping and one neon edge line, a
 * Warren truss under the screen, two lattice towers on footings, raking side stays, a marquee
 * board, a soft ground shadow and the legs mirrored faintly in the floor. It is drawn in wall
 * pixels (a 2560 by 720 scene) round the video's box and never over it: every fill round the
 * picture is a ring with the box cut out (even-odd), and the one blurred part (the neon's glow) is
 * clipped to the same ring. Nothing animates but the marquee's words (`DriveInFrame.tsx`).
 *
 * The shapes are the approved drawing's exact numbers, ported from its source; the notes in the
 * comments name each part as that drawing does.
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

/** One lattice tower: two battered verticals with zigzag lacing. */
function tower(cx: number, dir: number, y1: number): string {
  const a0 = cx - 9;
  const b0 = cx + 9;
  const a1 = cx - 9 - (dir < 0 ? 9 : 0);
  const b1 = cx + 9 + (dir > 0 ? 9 : 0);
  const at = (t: number, a: boolean) => (a ? a0 + (a1 - a0) * t : b0 + (b1 - b0) * t);
  const yy = (t: number) => y1 + (G - y1) * t;
  let lace = `M${n(at(0, true))} ${yy(0)}`;
  for (let i = 1; i <= 4; i++) lace += `L${n(at(i / 4, i % 2 === 0))} ${n(yy(i / 4))}`;
  let ties = '';
  for (let i = 1; i < 4; i++) ties += `M${n(at(i / 4, true))} ${n(yy(i / 4))}H${n(at(i / 4, false))}`;
  return `<path d="${lace}${ties}" stroke="${LACE}" stroke-width="1.5" fill="none"/>
      <path d="M${a0} ${y1}L${a1} ${G}M${b0} ${y1}L${b1} ${G}" stroke="${MEMBER}" stroke-width="5" stroke-linecap="square"/>
      <path d="M${a0 - 1.5} ${y1}L${a1 - 1.5} ${G}M${b0 - 1.5} ${y1}L${b1 - 1.5} ${G}" stroke="${RIM2}" stroke-width="1"/>`;
}

/** The whole frame as SVG markup (everything but the marquee's words), in wall pixels. */
function build(): string {
  const tl = L + 104;
  const tr = R - 104; // tower centres
  const y0 = B + 12;
  const y1 = B + 30; // the truss under the screen
  // The Warren truss under the screen: two chords and 28 bays.
  let zig = `M${L - 8} ${y1}`;
  const bays = 28;
  const bw = (V.w + 16) / bays;
  for (let i = 1; i <= bays; i++) zig += `L${n(L - 8 + bw * i)} ${i % 2 ? y0 : y1}`;
  const truss = `<path d="${zig}" stroke="${LACE}" stroke-width="1.5" fill="none"/>
    <path d="M${L - 12} ${y0}H${R + 12}M${L - 12} ${y1}H${R + 12}" stroke="${MEMBER}" stroke-width="4"/>
    <path d="M${L - 12} ${y0 - 2}H${R + 12}" stroke="${RIM2}" stroke-width="1"/>`;
  // Knee braces from each tower up to the truss, and raking side stays with lacing back to the surround.
  const knee = `<path d="M${tl + 14} ${y1 + 34}L${tl + 62} ${y1 + 2}M${tr - 14} ${y1 + 34}L${tr - 62} ${y1 + 2}" stroke="#3a2f66" stroke-width="2.5" stroke-linecap="round"/>`;
  const stay = (x: number, d: number) => `<path d="M${x} ${B - 96}L${x + d * 26} ${G}" stroke="${MEMBER}" stroke-width="4" stroke-linecap="round"/>
    <path d="M${x} ${B - 60}L${x + d * 10} ${B - 60 + 2}M${x} ${B - 20}L${x + d * 20.5} ${B - 18}M${x} ${B + 22}L${x + d * 32} ${B + 24}M${x} ${B - 60}L${x + d * 20.5} ${B - 18}M${x} ${B - 20}L${x + d * 32} ${B + 24}" stroke="${LACE}" stroke-width="1.5" fill="none"/>
    <path d="M${x - 1.5} ${B - 96}L${x + d * 26 - 1.5} ${G}" stroke="${RIM2}" stroke-width="1"/>`;
  const foot = (cx: number, w = 44) => `<path d="M${cx - w / 2} ${G}l4 -6h${w - 8}l4 6z" fill="#2a2050"/><path d="M${cx - w / 2 + 4} ${G - 6}h${w - 8}" stroke="${RIM}" stroke-width="1"/>`;
  const structure = `${stay(L - 12, -1)}${stay(R + 12, 1)}${tower(tl, -1, y1)}${tower(tr, 1, y1)}${knee}${truss}`;
  const feet = `${foot(tl - 4)}${foot(tr + 4)}${foot(L - 38, 22)}${foot(R + 38, 22)}`;
  // The marquee board hangs from the truss between the towers (its words are drawn by the component).
  const m = MARQUEE;
  const board = `<rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" rx="4" fill="#100a24" stroke="${LACE}" stroke-width="1.5"/>
    <rect x="${m.x + 4}" y="${m.y + 4}" width="${m.w - 8}" height="${m.h - 8}" rx="2" fill="none" stroke="rgba(255,176,84,.42)" stroke-width="1"/>`;
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
