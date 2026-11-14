/**
 * The four new music line types (Bars, Ribbon, Sparks, Skyline), the soft height cap and the one
 * calm resting line, ported from the lines playground the owner chose (`drawBars`, `drawRibbon`,
 * `drawSparks`, `drawSkyline`, `drawRestLine`, `px` and `typesStep`). Every constant below names the
 * playground constant it is. The types read the same shaped heights (`sampleDance`) and kick as the
 * mountains, are drawn above the horizon only and never inside a claimed picture box.
 *
 * Nothing here allocates on the frame path: the per type state is made once (`createLineTypes`),
 * and the colour gradients are made again only when the palette, the centre or the canvas changes.
 */
import { sampleDance } from '../audio/spectrum';
import { DANCE_LIMIT } from '../audio/dance';
import { PLAY_TINT } from './echo';
import type { LineColours, LineType } from './linesSettings';
import type { SkyBox } from './sky';

/** The stage width in design pixels (playground `2560`). */
const W = 2560;
/** Bands on each side of the centre (playground `NB`). */
const BANDS = 32;
/** Columns: one per band, mirrored about the centre, bass in the middle (playground `NCOL`). */
export const TYPE_COLUMNS = BANDS * 2;

/** The gain of the new types, which start from the flat horizon (playground `NEW_GAIN`). */
export const NEW_GAIN = 1.7;
/** The short hold: the larger of now, this share 0.1 s ago and the next share 0.2 s ago (playground `px`). */
const HOLD_STEP_S = 0.1;
const HOLD_1 = 0.8;
const HOLD_2 = 0.6;
/** The cap on Mountains is skipped while it is within this of the dance limit (playground `capped`). */
const CAP_SLACK = 0.02;

/** Gravity in px/s2 at the usual Smoothness, divided by (2^y)^2 (playground `typesStep` `520`). */
export const FALL_GRAVITY = 520;
/** Bars' markers fall at this share of the gravity (playground `g * 0.35`). */
const MARKER_FALL = 0.35;
/** Sparks are thrown up over about this long (playground `dt / 0.03`). */
const THROW_S = 0.03;
/** A spark is thrown only when the height is this far above it (playground `dotY + 2`). */
const THROW_MARGIN = 2;

/** The edge fade: full to this share of the half span, then eased to 0 (playground `edge`). */
const EDGE_FULL = 0.62;
/** Columns keep this share at the edge (playground `0.25 + 0.75 * edge`). */
const EDGE_FLOOR = 0.25;

/** Bars (playground `drawBars`): gap between bars, corner radius, body, cap and marker. */
const BAR_GAP = 10;
const BAR_RADIUS = 4;
const BAR_BASE = 3;
const BAR_BODY_A = 0.42;
const BAR_CAP_A = 0.95;
const BAR_CAP_H = 3;
const MARKER_A = 0.8;
const MARKER_H = 2.5;
const MARKER_LIFT = 6;
const MARKER_SHOW = 4;

/** Ribbon (playground `ribbonPath`, `drawRibbon`). */
const RIBBON_STEP = 6;
const RIBBON_LIFT = 2;
const RIBBON_EDGE_FLOOR = 0.2;
const RIBBON_TAPER = 6;
/** The two trails: age in seconds, height share, opacity, width. */
const RIBBON_TRAILS = [
  [0.5, 0.8, 0.16, 1.5],
  [0.25, 0.9, 0.3, 2],
] as const;
const RIBBON_FILL_A = 0.14;
const RIBBON_GLOW_A = 0.22;
const RIBBON_GLOW_W = 9;
const RIBBON_GLOW_KICK = 5;
const RIBBON_W = 2.6;
const RIBBON_KICK = 1.4;

/** Sparks (playground `drawSparks`): jitter, radius, trail dots, halo and core. */
const SPARK_SEED = 20261113;
const SPARK_JITTER = 12;
const SPARK_R = 3.4;
const SPARK_R_RANGE = 2;
const SPARK_LIFT = 3;
const SPARK_LIT_PX = 60;
/** The two trail dots: place along the throw, opacity, radius share. */
const SPARK_TRAILS = [
  [0.38, 0.2, 0.55],
  [0.68, 0.36, 0.75],
] as const;
const SPARK_HALO_R = 2.8;
const SPARK_HALO_A = 0.26;
const SPARK_CORE_WHITE = 0.35;
/** The core's whitening is kept as this many steps of `lit` (made once, not per frame). */
const SPARK_LIT_STEPS = 8;
const TAU = 6.2832;

/** Skyline (playground `drawSkyline`): floor height and the gap between blocks. */
export const SKYLINE_FLOOR = 12;
const SKYLINE_GAP = 6;

/** The resting opacity of the Mountains' lines with Flat (playground `frame`, `flat ? 0.6`). */
export const FLAT_REST_OPACITY = 0.6;

/** The calm resting line for Flat (playground `drawRestLine`). */
const REST_SPAN = 0.86;
const REST_GLOW_A = 0.16;
const REST_GLOW_W = 7;
const REST_A = 0.6;
const REST_W = 1.6;

export type Rgb = number[];
/** Three colour stops: the left edge, the centre and the right edge (as `HorizonEcho.tint`). */
export interface LineStops {
  left: Rgb;
  centre: Rgb;
  right: Rgb;
}

/** The Colours choices other than "From the look" (the notes' table). */
export const LINE_PALETTES: Readonly<Record<Exclude<LineColours, 'look'>, LineStops>> = {
  floor: { left: [255, 176, 84], centre: [255, 92, 150], right: [84, 214, 255] },
  sunset: { left: [255, 196, 96], centre: [255, 132, 96], right: [255, 72, 150] },
  ice: { left: [120, 170, 255], centre: [224, 240, 255], right: [150, 200, 255] },
  mint: { left: [110, 240, 170], centre: [84, 236, 214], right: [64, 200, 255] },
};

/** The stops for a Colours choice: "From the look" is the live tint (or `PLAY_TINT`), the rest are fixed. */
export function lineStops(colours: LineColours, look: LineStops = PLAY_TINT): LineStops {
  return colours === 'look' ? look : LINE_PALETTES[colours];
}

/** The smoothstep the playground uses (`sstep`). */
export function sstep(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

/** How lively and how smooth, as -1 to 1 (the notes' x and y). */
export const livelyX = (lively: number): number => (lively - 50) / 50;
export const smoothY = (smooth: number): number => (smooth - 50) / 50;
/** How lively scales the line amplitude: 2^(0.8x) (playground `ampK`). */
export const ampScale = (lively: number): number => Math.pow(2, 0.8 * livelyX(lively));
/** The dance limit for a How lively value: `DANCE_LIMIT` times 2^(0.75x) (playground `P.limit`). */
export const danceLimit = (lively: number): number => DANCE_LIMIT * Math.pow(2, 0.75 * livelyX(lively));
/** The fall gravity for a Smoothness value: 520 / (2^y)^2 (playground `typesStep`). */
export function fallGravity(smooth: number): number {
  const fall = Math.pow(2, smoothY(smooth));
  return FALL_GRAVITY / (fall * fall);
}

/**
 * The Mountains' height cap (playground `capped`): a hit may throw a line `height` pixels at most,
 * so the sampled height is capped at `L = height / amp` with `L * tanh(v / L)`. Skipped while `L`
 * is within 0.02 of the dance limit, which is the case at the usual setting (104 / 57.8 = 1.8), so
 * the default path reads the bands exactly as before. Made once; `bands` reads ages.
 */
export interface MountainCap {
  L: number;
  on: boolean;
  readonly bands: (u: number, age: number) => number;
}

export function createMountainCap(read: (u: number, age: number) => number = sampleDance): MountainCap {
  const cap: MountainCap = {
    L: 0,
    on: false,
    bands: (u, age) => {
      const v = read(u, age);
      return cap.on ? cap.L * Math.tanh(v / cap.L) : v;
    },
  };
  return cap;
}

/** Set the cap for this frame from the Height setting, the line amplitude and the dance limit. */
export function setMountainCap(cap: MountainCap, height: number, amp: number, limit: number): void {
  cap.L = amp > 0 ? height / amp : limit;
  cap.on = cap.L < limit - CAP_SLACK;
}

/**
 * One frame's input for the new types. One object is kept and its fields set each frame.
 * `bands` reads the shaped heights by age (0 is now); the app's history by default.
 */
export interface LineTypeFrame {
  type: LineType;
  /** The Height setting: the soft cap in pixels (new types always go through it). */
  height: number;
  smooth: number;
  /** The line amplitude in design pixels (`HorizonEcho.amp`, already scaled by How lively). */
  amp: number;
  cx: number;
  hs: number;
  hy: number;
  scale: number;
  /** Opacity of the live drawing (0 to 1). */
  live: number;
  /** Opacity of the Flat resting line (0 to 1); 0 draws none. */
  restLine: number;
  kick: number;
  dt: number;
  boxes: readonly SkyBox[];
  stops: LineStops;
  bands: (u: number, age: number) => number;
}

export function createLineFrame(): LineTypeFrame {
  return {
    type: 'mountains',
    height: 104,
    smooth: 50,
    amp: 0,
    cx: W / 2,
    hs: 900,
    hy: 505,
    scale: 1,
    live: 0,
    restLine: 0,
    kick: 0,
    dt: 1 / 30,
    boxes: [],
    stops: PLAY_TINT,
    bands: sampleDance,
  };
}

/** The colour cache: gradients in design pixels, made again only when their key changes. */
interface ColourCache {
  ctx: CanvasRenderingContext2D | null;
  key: Float64Array;
  grad: CanvasGradient | null;
  /** The sparks' core gradients, whitened by `lit` in `SPARK_LIT_STEPS` steps. */
  lit: (CanvasGradient | null)[];
}

/** The per type state, made once: bars' markers and the sparks. */
export interface LineTypesState {
  peakY: Float32Array;
  peakV: Float32Array;
  dotY: Float32Array;
  dotV: Float32Array;
  dotJ: Float32Array;
  dotR: Float32Array;
  colour: ColourCache;
}

export function createLineTypes(): LineTypesState {
  const s: LineTypesState = {
    peakY: new Float32Array(TYPE_COLUMNS),
    peakV: new Float32Array(TYPE_COLUMNS),
    dotY: new Float32Array(TYPE_COLUMNS),
    dotV: new Float32Array(TYPE_COLUMNS),
    dotJ: new Float32Array(TYPE_COLUMNS),
    dotR: new Float32Array(TYPE_COLUMNS),
    colour: { ctx: null, key: new Float64Array(12).fill(NaN), grad: null, lit: new Array<CanvasGradient | null>(SPARK_LIT_STEPS + 1).fill(null) },
  };
  // The sparks' jitter and size, from the playground's fixed-seed generator.
  let seed = SPARK_SEED;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let k = 0; k < TYPE_COLUMNS; k++) {
    s.dotJ[k] = (rnd() - 0.5) * SPARK_JITTER;
    s.dotR[k] = SPARK_R + rnd() * SPARK_R_RANGE;
  }
  return s;
}

/** Clear the markers and sparks (they then rise from the horizon again). */
export function clearLineTypes(s: LineTypesState): void {
  s.peakY.fill(0);
  s.peakV.fill(0);
  s.dotY.fill(0);
  s.dotV.fill(0);
}

/** At rest the new drawing keeps this share unless the look is Flat (playground `frame`, `0.92`). */
const REST_KEEP = 0.92;
/** Sparks stay as a dotted row on the horizon at rest, at least this bright (playground `frame`). */
const SPARKS_REST = 0.5;
const SPARKS_REST_FLAT = 0.85;

/**
 * The opacity share of a new type's live drawing at `rest` (0 playing to 1 settled), as the
 * playground's `frame`: it lies down as the music stops; Sparks stay as a dotted row.
 */
export function typeLiveShare(type: LineType, rest: number, flat: boolean): number {
  const live = 1 - sstep(rest) * (flat ? 1 : REST_KEEP);
  if (type === 'sparks') return Math.max(live, flat ? SPARKS_REST_FLAT : SPARKS_REST);
  return live;
}

/** A column's centre x (playground `colX`). */
export function colX(f: LineTypeFrame, k: number): number {
  const pitch = f.hs / BANDS;
  return k < BANDS ? f.cx - (BANDS - 1 - k + 0.5) * pitch : f.cx + (k - BANDS + 0.5) * pitch;
}

/** A column's place in the spectrum, 0 (bass, the middle) to 1 (the edges) (playground `colU`). */
export function colU(k: number): number {
  return (k < BANDS ? BANDS - 1 - k : k - BANDS) / (BANDS - 1);
}

/** The edge fade at x (playground `edge`). */
function edge(f: LineTypeFrame, x: number): number {
  const u = Math.abs(x - f.cx) / f.hs;
  if (u >= 1) return 0;
  if (u < EDGE_FULL) return 1;
  return 1 - sstep((u - EDGE_FULL) / (1 - EDGE_FULL));
}

/**
 * The height in pixels of a new type at `u`, `age` seconds back (playground `px`): the short hold
 * of three moments, times the amplitude and the gain, through the Height cap `H * tanh(v / H)`.
 */
export function typePx(f: LineTypeFrame, u: number, age: number): number {
  const a = f.bands(u, age);
  const b = HOLD_1 * f.bands(u, age + HOLD_STEP_S);
  const c = HOLD_2 * f.bands(u, age + 2 * HOLD_STEP_S);
  const held = a > b ? (a > c ? a : c) : b > c ? b : c;
  const v = held * f.amp * NEW_GAIN;
  return f.height * Math.tanh(v / f.height);
}

/**
 * Advance the bars' markers and the sparks by `f.dt` (playground `typesStep`): markers sit on the
 * bar, then float down; sparks are thrown to the hit's height, then fall under gravity.
 */
export function stepLineTypes(s: LineTypesState, f: LineTypeFrame): void {
  const g = fallGravity(f.smooth);
  const dt = f.dt;
  for (let k = 0; k < TYPE_COLUMNS; k++) {
    const h = typePx(f, colU(k), 0) * (EDGE_FLOOR + (1 - EDGE_FLOOR) * edge(f, colX(f, k)));
    if (h >= s.peakY[k]) {
      s.peakY[k] = h;
      s.peakV[k] = 0;
    } else {
      s.peakV[k] += g * MARKER_FALL * dt;
      s.peakY[k] = Math.max(h, s.peakY[k] - s.peakV[k] * dt);
    }
    if (h > s.dotY[k] + THROW_MARGIN) {
      s.dotY[k] += (h - s.dotY[k]) * Math.min(1, dt / THROW_S);
      s.dotV[k] = 0;
    } else {
      s.dotV[k] += g * dt;
      s.dotY[k] = Math.max(0, s.dotY[k] - s.dotV[k] * dt);
    }
  }
}

const css = (c: Rgb): string => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},1)`;
const mixc = (a: Rgb, b: Rgb, t: number): number[] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WHITE = [255, 255, 255];

/** A horizontal gradient over the stage with the playground's four stops (`hgrad`), each whitened by `white`. */
function makeGradient(ctx: CanvasRenderingContext2D, f: LineTypeFrame, white: number): CanvasGradient {
  const c0 = Math.min(0.99, Math.max(0.01, f.cx / W));
  const g = ctx.createLinearGradient(0, 0, W, 0);
  const stops = [f.stops.left, f.stops.centre, mixc(f.stops.centre, f.stops.right, 0.5), f.stops.right];
  const at = [0, c0, c0 + (1 - c0) * 0.6, 1];
  for (let i = 0; i < 4; i++) g.addColorStop(at[i], css(white > 0 ? mixc(stops[i], WHITE, white) : stops[i]));
  return g;
}

/** The cached gradient for this frame; made again only when the canvas, centre or stops change. */
function gradient(s: LineTypesState, ctx: CanvasRenderingContext2D, f: LineTypeFrame): CanvasGradient {
  const c = s.colour;
  const k = c.key;
  const st = f.stops;
  const same =
    c.ctx === ctx && c.grad !== null && k[0] === f.cx &&
    k[1] === st.left[0] && k[2] === st.left[1] && k[3] === st.left[2] &&
    k[4] === st.centre[0] && k[5] === st.centre[1] && k[6] === st.centre[2] &&
    k[7] === st.right[0] && k[8] === st.right[1] && k[9] === st.right[2];
  if (!same) {
    c.ctx = ctx;
    k[0] = f.cx;
    k[1] = st.left[0];
    k[2] = st.left[1];
    k[3] = st.left[2];
    k[4] = st.centre[0];
    k[5] = st.centre[1];
    k[6] = st.centre[2];
    k[7] = st.right[0];
    k[8] = st.right[1];
    k[9] = st.right[2];
    c.grad = makeGradient(ctx, f, 0);
    c.lit.fill(null);
  }
  return c.grad!;
}

/** The sparks' core gradient at a `lit` step (made on first use after a change). */
function litGradient(s: LineTypesState, ctx: CanvasRenderingContext2D, f: LineTypeFrame, step: number): CanvasGradient {
  const lit = s.colour.lit;
  let g = lit[step];
  if (!g) {
    g = makeGradient(ctx, f, (SPARK_CORE_WHITE * step) / SPARK_LIT_STEPS);
    lit[step] = g;
  }
  return g;
}

/** A bar's outline with rounded top corners (playground `rr`). */
function barPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

/** Bars (playground `drawBars`): 64 columns, a soft body, a bright cap and a marker that floats down. */
function drawBars(ctx: CanvasRenderingContext2D, s: LineTypesState, f: LineTypeFrame, a: number): void {
  const w = f.hs / BANDS - BAR_GAP;
  ctx.fillStyle = gradient(s, ctx, f);
  for (let k = 0; k < TYPE_COLUMNS; k++) {
    const x = colX(f, k);
    const e = EDGE_FLOOR + (1 - EDGE_FLOOR) * edge(f, x);
    const h = BAR_BASE + typePx(f, colU(k), 0) * e;
    ctx.globalAlpha = a * BAR_BODY_A * e;
    barPath(ctx, x - w / 2, f.hy - h, w, h, BAR_RADIUS);
    ctx.fill();
    ctx.globalAlpha = a * BAR_CAP_A * e;
    ctx.fillRect(x - w / 2, f.hy - h, w, BAR_CAP_H);
    const py = BAR_BASE + s.peakY[k];
    if (py > h + MARKER_SHOW) {
      ctx.globalAlpha = a * MARKER_A * e;
      ctx.fillRect(x - w / 2, f.hy - py - MARKER_LIFT, w, MARKER_H);
    }
  }
}

/** The ribbon's path, `age` seconds back, at `gain` of its height (playground `ribbonPath`). */
function ribbonPath(ctx: CanvasRenderingContext2D, f: LineTypeFrame, age: number, gain: number): void {
  ctx.beginPath();
  const x0 = f.cx - f.hs;
  for (let x = x0; x <= f.cx + f.hs; x += RIBBON_STEP) {
    const u = Math.abs(x - f.cx) / f.hs;
    const y = f.hy - RIBBON_LIFT - typePx(f, u, age) * gain * (RIBBON_EDGE_FLOOR + (1 - RIBBON_EDGE_FLOOR) * edge(f, x)) * sstep((1 - u) * RIBBON_TAPER);
    if (x === x0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/** Ribbon (playground `drawRibbon`): two trails, a faint fill, a glow wider on the kick, the line. */
function drawRibbon(ctx: CanvasRenderingContext2D, s: LineTypesState, f: LineTypeFrame, a: number): void {
  const g = gradient(s, ctx, f);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = g;
  for (let i = 0; i < RIBBON_TRAILS.length; i++) {
    const [age, gain, al, lw] = RIBBON_TRAILS[i];
    ribbonPath(ctx, f, age, gain);
    ctx.globalAlpha = a * al;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  ribbonPath(ctx, f, 0, 1);
  ctx.lineTo(f.cx + f.hs, f.hy);
  ctx.lineTo(f.cx - f.hs, f.hy);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.globalAlpha = a * RIBBON_FILL_A;
  ctx.fill();
  ribbonPath(ctx, f, 0, 1);
  ctx.globalAlpha = a * RIBBON_GLOW_A;
  ctx.lineWidth = RIBBON_GLOW_W + RIBBON_GLOW_KICK * f.kick;
  ctx.stroke();
  ctx.globalAlpha = a;
  ctx.lineWidth = RIBBON_W + RIBBON_KICK * f.kick;
  ctx.stroke();
}

/** Sparks (playground `drawSparks`): two trail dots along the throw, a soft halo and a bright core. */
function drawSparks(ctx: CanvasRenderingContext2D, s: LineTypesState, f: LineTypeFrame, a: number): void {
  const g = gradient(s, ctx, f);
  for (let k = 0; k < TYPE_COLUMNS; k++) {
    const x = colX(f, k) + s.dotJ[k];
    const e = EDGE_FLOOR + (1 - EDGE_FLOOR) * edge(f, x);
    const y = s.dotY[k];
    const lit = Math.min(1, Math.max(0, y / SPARK_LIT_PX));
    const r = s.dotR[k];
    ctx.fillStyle = g;
    for (let i = 0; i < SPARK_TRAILS.length; i++) {
      const [place, al, rs] = SPARK_TRAILS[i];
      ctx.globalAlpha = a * al * e * lit;
      ctx.beginPath();
      ctx.arc(x, f.hy - SPARK_LIFT - y * place, r * rs, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = a * SPARK_HALO_A * e * (0.4 + 0.6 * lit);
    ctx.beginPath();
    ctx.arc(x, f.hy - SPARK_LIFT - y, r * SPARK_HALO_R, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = a * (0.55 + 0.45 * lit) * e;
    ctx.fillStyle = litGradient(s, ctx, f, Math.round(lit * SPARK_LIT_STEPS));
    ctx.beginPath();
    ctx.arc(x, f.hy - SPARK_LIFT - y, r, 0, TAU);
    ctx.fill();
  }
}

/** Skyline (playground `drawSkyline`): 32 blocks two bands wide, built of 12 px floors, the top one bright. */
function drawSkyline(ctx: CanvasRenderingContext2D, s: LineTypesState, f: LineTypeFrame, a: number): void {
  const w = (f.hs / BANDS) * 2 - SKYLINE_GAP;
  ctx.fillStyle = gradient(s, ctx, f);
  for (let k = 0; k < TYPE_COLUMNS; k += 2) {
    const x = (colX(f, k) + colX(f, k + 1)) / 2;
    const e = EDGE_FLOOR + (1 - EDGE_FLOOR) * edge(f, x);
    const h = ((typePx(f, colU(k), 0) + typePx(f, colU(k + 1), 0)) / 2) * e;
    const n = Math.round(h / SKYLINE_FLOOR);
    for (let j = 0; j <= n; j++) {
      ctx.globalAlpha = a * e * (j === n ? 0.95 : 0.2 + 0.3 * (j / Math.max(1, n)));
      ctx.fillRect(x - w / 2, f.hy - (j + 1) * SKYLINE_FLOOR + 2, w, j === 0 ? SKYLINE_FLOOR - 2 : SKYLINE_FLOOR - 3);
    }
  }
}

/** Flat at rest for the new types (playground `drawRestLine`): one calm line on the horizon. */
function drawRestLine(ctx: CanvasRenderingContext2D, s: LineTypesState, f: LineTypeFrame, a: number): void {
  ctx.strokeStyle = gradient(s, ctx, f);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(f.cx - f.hs * REST_SPAN, f.hy - 2);
  ctx.lineTo(f.cx + f.hs * REST_SPAN, f.hy - 2);
  ctx.globalAlpha = a * REST_GLOW_A;
  ctx.lineWidth = REST_GLOW_W;
  ctx.stroke();
  ctx.globalAlpha = a * REST_A;
  ctx.lineWidth = REST_W;
  ctx.stroke();
}

/**
 * Draw a new type (and the Flat resting line) on `ctx` in design pixels, clipped to above the
 * horizon with every claimed picture box cut out, added to what is there (playground `frame`).
 * Draws nothing for Mountains or when nothing is visible. Call `stepLineTypes` first.
 */
export function drawLineType(ctx: CanvasRenderingContext2D, s: LineTypesState, f: LineTypeFrame): void {
  if (f.type === 'mountains') return;
  if (f.live <= 0.001 && f.restLine <= 0.001) return;
  ctx.save();
  ctx.setTransform(f.scale, 0, 0, f.scale, 0, 0);
  ctx.beginPath();
  ctx.rect(0, 0, W, f.hy + 1);
  for (let i = 0; i < f.boxes.length; i++) {
    const b = f.boxes[i];
    ctx.rect(b[0] - 2, b[1] - 2, b[2] + 4, b[3] + 4);
  }
  ctx.clip('evenodd');
  ctx.globalCompositeOperation = 'lighter';
  if (f.restLine > 0.001) drawRestLine(ctx, s, f, f.restLine);
  if (f.live > 0.001) {
    if (f.type === 'bars') drawBars(ctx, s, f, f.live);
    else if (f.type === 'ribbon') drawRibbon(ctx, s, f, f.live);
    else if (f.type === 'sparks') drawSparks(ctx, s, f, f.live);
    else drawSkyline(ctx, s, f, f.live);
  }
  ctx.restore();
}
