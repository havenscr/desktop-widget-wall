/**
 * The weather's drawing for the horizon: rain streaks, rings on the lake, mist banks, a hazier sky,
 * thin wind lines and drifting wool and leaves. Every function is a pure function of time `t`
 * (seconds): each particle's place comes from a hash of its number and its cycle, so nothing is
 * stored between frames and nothing is allocated in a frame. Coordinates are the wall's design
 * pixels (2560 by 720); the caller sets the context transform. The option records are owned by the
 * caller (`weatherLayer.ts`) and reused: a frame mutates their fields and builds none.
 */

export const WALL_W = 2560;
export const WALL_H = 720;

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** A fixed pseudo-random number in [0, 1) for a whole number `i` and a channel `k`. */
export function rnd(i: number, k: number): number {
  let x = (Math.imul(i | 0, 374761393) + Math.imul(k | 0, 668265263)) ^ 0x5bd1e995;
  x = Math.imul(x ^ (x >>> 15), 2246822519);
  x = Math.imul(x ^ (x >>> 13), 3266489917);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** The part of the wall that is drawn: particles outside it are skipped. */
export interface FxView {
  x: number;
  w: number;
}

/** Rectangles that stay empty (a picture's box, a keep-clear card), flat: x0, y0, x1, y1 each, already grown. */
export interface FxBoxes {
  v: number[];
  n: number;
}

/** True when the point lies inside one of the boxes. */
export function inBoxes(b: FxBoxes, x: number, y: number): boolean {
  const v = b.v;
  for (let i = 0; i < b.n; i += 4) {
    if (x >= v[i] && x <= v[i + 2] && y >= v[i + 1] && y <= v[i + 3]) return true;
  }
  return false;
}

export interface StreakSet {
  n: number;
  seed: number;
  lenA: number;
  lenB: number;
  speedA: number;
  speedB: number;
  /** Degrees from vertical, leaning right as they fall. */
  deg: number;
  top: number;
  bottom: number;
  /** A cached colour string (made when the level changes, never in a frame). */
  color: string;
  lw: number;
  /** The fade ramp and the idle fade, multiplied into the stroke's opacity. */
  fade: number;
  view: FxView;
  boxes: FxBoxes;
}

/** Slanted rain streaks, one `stroke()` for the whole set. A streak falls from `top` to `bottom`, then starts again at a new x. */
export function streaks(ctx: CanvasRenderingContext2D, t: number, o: StreakSet): void {
  const ang = (o.deg * Math.PI) / 180;
  const sn = Math.sin(ang);
  const cs = Math.cos(ang);
  const tan = sn / cs;
  const fall = o.bottom - o.top;
  const lead = fall * Math.abs(tan) + 60;
  const span = WALL_W + lead + 60;
  const vx0 = o.view.x - 40;
  const vx1 = o.view.x + o.view.w + 40;
  ctx.beginPath();
  for (let i = 0; i < o.n; i++) {
    const v = lerp(o.speedA, o.speedB, rnd(i, o.seed + 1));
    const len = lerp(o.lenA, o.lenB, rnd(i, o.seed + 2));
    const path = fall + len;
    const s = t * v + rnd(i, o.seed + 3) * path;
    const cyc = Math.floor(s / path);
    const yh = o.top + (s - cyc * path); // the head (lower end)
    const xh = rnd(i * 7919 + cyc, o.seed + 4) * span - lead + (yh - o.top) * tan;
    const xt = xh - len * sn;
    const yt = yh - len * cs;
    if (xh < vx0 || xt > vx1) continue;
    if (o.boxes.n > 0 && (inBoxes(o.boxes, xh, yh) || inBoxes(o.boxes, xt, yt))) continue;
    ctx.moveTo(xh, yh);
    ctx.lineTo(xt, yt);
  }
  const cap = ctx.lineCap;
  const width = ctx.lineWidth;
  ctx.globalAlpha = o.fade;
  ctx.strokeStyle = o.color;
  ctx.lineWidth = o.lw;
  ctx.lineCap = 'round';
  ctx.stroke();
  // The context is shared: what was set before is put back.
  ctx.lineCap = cap;
  ctx.lineWidth = width;
}

export interface RingSet {
  n: number;
  hy: number;
  alpha: number;
  lifeA: number;
  lifeB: number;
  fade: number;
  view: FxView;
  boxes: FxBoxes;
}

/** The one ring colour: the opacity goes through `globalAlpha`, so no colour string is made per ring. */
export const RING_COLOR = 'rgb(160,236,246)';

/** Rings where drops meet the lake: flat ellipses that widen and fade. `n` is how many are alive at once on the whole wall. */
export function rings(ctx: CanvasRenderingContext2D, t: number, o: RingSet): void {
  const width = ctx.lineWidth;
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = RING_COLOR;
  const vx0 = o.view.x - 40;
  const vx1 = o.view.x + o.view.w + 40;
  for (let i = 0; i < o.n; i++) {
    const life = lerp(o.lifeA, o.lifeB, rnd(i, 21));
    const s = t / life + rnd(i, 22);
    const cyc = Math.floor(s);
    const p = s - cyc;
    const x = rnd(i * 131 + cyc, 23) * WALL_W;
    if (x < vx0 || x > vx1) continue;
    const d = Math.pow(rnd(i * 131 + cyc, 24), 1.35); // more of them far away, as the lake's perspective has it
    const y = o.hy + 9 + d * (WALL_H - 6 - o.hy - 9);
    if (o.boxes.n > 0 && inBoxes(o.boxes, x, y)) continue;
    const k = 0.3 + 0.7 * d;
    const rx = (2 + 26 * p) * k * 1.5;
    const ry = Math.max(0.8, rx * 0.26);
    ctx.globalAlpha = o.fade * o.alpha * Math.pow(1 - p, 1.5) * Math.min(1, p * 8) * (0.55 + 0.45 * k);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, 6.2832);
    ctx.stroke();
  }
  ctx.lineWidth = width;
}

const BLOB_W = 256;
const BLOB_H = 64;
let blob: HTMLCanvasElement | null = null;

/** One soft blob for the mist, made once and lazily; null where no 2D context exists (a test stub). */
export function blobSprite(): HTMLCanvasElement | null {
  if (blob) return blob;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = BLOB_W;
  c.height = BLOB_H;
  const g = c.getContext('2d');
  if (!g) return null;
  const gr = g.createRadialGradient(128, 32, 0, 128, 32, 128);
  gr.addColorStop(0, 'rgba(190,185,255,1)');
  gr.addColorStop(0.5, 'rgba(170,165,245,.42)');
  gr.addColorStop(1, 'rgba(160,150,240,0)');
  g.save();
  g.translate(0, 32);
  g.scale(1, 0.25);
  g.translate(0, -32);
  g.fillStyle = gr;
  g.fillRect(0, -200, BLOB_W, 464);
  g.restore();
  blob = c;
  return c;
}

/** Forget the shared blob (tests). */
export function dropBlobSprite(): void {
  blob = null;
}

export interface MistSet {
  n: number;
  seed: number;
  yA: number;
  yB: number;
  wA: number;
  wB: number;
  alpha: number;
  /** Pixels a second (the drift is integrated by the caller into `t`). */
  speed: number;
  fade: number;
  view: FxView;
  /** Pixels added to every x, and the pixels around the view that still draw (the cache's margin). */
  shift: number;
  margin: number;
}

/** Slow mist banks: a soft blob drawn 700 to 1400 px wide and a fifth as tall, drifting right, breathing by 30 percent. */
export function mist(ctx: CanvasRenderingContext2D, t: number, o: MistSet, sprite: CanvasImageSource | null): void {
  if (!sprite) return;
  for (let i = 0; i < o.n; i++) {
    const w = lerp(o.wA, o.wB, rnd(i, o.seed + 1));
    const h = w * 0.2;
    const x = ((rnd(i, o.seed + 2) * (WALL_W + w) + t * o.speed * (0.6 + 0.8 * rnd(i, o.seed + 3))) % (WALL_W + w)) - w;
    if (x > o.view.x + o.view.w + o.margin || x + w < o.view.x - o.margin) continue;
    const y = lerp(o.yA, o.yB, rnd(i, o.seed + 4)) - h / 2;
    ctx.globalAlpha = o.fade * o.alpha * (0.7 + 0.3 * Math.sin(t * 0.11 + i * 1.7));
    ctx.drawImage(sprite, x + o.shift, y, w, h);
  }
}

/** A darker, hazier sky: a veil over the sky part only (y 0 to `hy`), k 0 to 1. It never moves, so the layer caches it. */
export function dimSky(ctx: CanvasRenderingContext2D, hy: number, k: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, hy);
  g.addColorStop(0, `rgba(7,5,22,${(0.34 * k).toFixed(3)})`);
  g.addColorStop(0.62, `rgba(20,16,48,${(0.26 * k).toFixed(3)})`);
  g.addColorStop(1, `rgba(96,88,160,${(0.2 * k).toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WALL_W, hy);
}

export interface GustSet {
  n: number;
  top: number;
  bottom: number;
  alpha: number;
  fade: number;
  view: FxView;
}

/**
 * Thin wind lines that cross the sky and fade at both ends. Each line makes one linear gradient (at
 * most five a frame): the one allocation the weather allows. The opacity goes through `globalAlpha`.
 */
export function gusts(ctx: CanvasRenderingContext2D, t: number, o: GustSet): void {
  const cap = ctx.lineCap;
  const width = ctx.lineWidth;
  ctx.lineWidth = 1.25;
  ctx.lineCap = 'round';
  for (let i = 0; i < o.n; i++) {
    const period = lerp(6.5, 10, rnd(i, 41));
    const s = t / period + rnd(i, 42);
    const cyc = Math.floor(s);
    const q = (s - cyc) / 0.5; // on the way for half of its period, then a pause
    if (q >= 1) continue;
    const len = lerp(240, 430, rnd(i * 53 + cyc, 43));
    const y0 = lerp(o.top, o.bottom, rnd(i * 53 + cyc, 44));
    const xs = rnd(i * 53 + cyc, 45) * (WALL_W - 500) - 100;
    const xh = xs + q * period * 0.5 * 330; // 330 px a second
    if (xh < o.view.x - 20 || xh - len > o.view.x + o.view.w + 20) continue;
    const ph = rnd(i * 53 + cyc, 46) * 6.28;
    const amp = lerp(5, 10, rnd(i * 53 + cyc, 47));
    const g = ctx.createLinearGradient(xh - len, 0, xh, 0);
    g.addColorStop(0, 'rgba(205,215,255,0)');
    g.addColorStop(0.65, 'rgb(205,215,255)');
    g.addColorStop(1, 'rgba(205,215,255,0)');
    ctx.globalAlpha = o.fade * o.alpha * Math.sin(Math.PI * q);
    ctx.strokeStyle = g;
    ctx.beginPath();
    for (let x = xh - len; x <= xh; x += 10) {
      const y = y0 + amp * Math.sin(x / 150 + ph) - (x - xs) * 0.012;
      if (x === xh - len) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.lineCap = cap;
  ctx.lineWidth = width;
}

/** The small pixel grid of the drifting specks, in design pixels (the wall's little pixel is 3). */
export const SPECK_PX = 3;
const TUFT: readonly string[] = ['.W', 'WW'];
const LEAF: readonly string[] = ['o.', 'oo'];
const TUFT_COLOR = '#dcd3fb';
const LEAF_COLOR = '#5df2b6';

export interface DriftSet {
  n: number;
  yA: number;
  yB: number;
  fade: number;
  view: FxView;
  boxes: FxBoxes;
}

/** Loose wool tufts (two in three) and clover leaves (one in three) that drift right along the ground, snapped to the small grid. */
export function drift(ctx: CanvasRenderingContext2D, t: number, o: DriftSet): void {
  ctx.globalAlpha = 0.85 * o.fade;
  for (let i = 0; i < o.n; i++) {
    const v = lerp(95, 150, rnd(i, 51));
    const span = WALL_W + 160;
    const s = t * v + rnd(i, 52) * span;
    const cyc = Math.floor(s / span);
    const x = s - cyc * span - 80;
    if (x < o.view.x - 12 || x > o.view.x + o.view.w + 12) continue;
    const y = lerp(o.yA, o.yB, rnd(i * 97 + cyc, 53)) + 7 * Math.sin(t * lerp(1.1, 1.9, rnd(i, 54)) + i);
    if (o.boxes.n > 0 && inBoxes(o.boxes, x, y)) continue;
    const leaf = i % 3 === 2;
    const flip = Math.floor(t * 2.2 + i) % 2 === 1; // the tuft tumbles: mirrored twice a second or so
    const map = leaf ? LEAF : TUFT;
    ctx.fillStyle = leaf ? LEAF_COLOR : TUFT_COLOR;
    const gx = Math.round(x / SPECK_PX) * SPECK_PX;
    const gy = Math.round(y / SPECK_PX) * SPECK_PX;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        if (map[r][flip ? 1 - c : c] !== '.') ctx.fillRect(gx + c * SPECK_PX, gy + r * SPECK_PX, SPECK_PX, SPECK_PX);
      }
    }
  }
}
