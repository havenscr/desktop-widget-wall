import { DROP_S, envOf, sstep } from './mix';
import type { GlitchLook } from '../horizon/vibeSettings';

/** Slices per drop and how long one seed lasts (seeds crossfade, so a slice never pops). */
export const SLICES = 7;
export const SEED_HZ = 11;

/** Where a front canvas pixel reads from the horizon canvas: `hx = fx * ax + bx`, `hy = fy * ay + by`. */
export interface HzMap {
  ax: number;
  bx: number;
  ay: number;
  by: number;
}

/** What the glitch copies from. The DOM cannot be read; the horizon canvas and the art picture can. */
export interface GlitchSources {
  hz: HTMLCanvasElement | null;
  map: HzMap;
  img: HTMLImageElement | null;
  /** The art's box in front canvas pixels. */
  art: { x: number; y: number; w: number; h: number };
}

export interface Glitch {
  /** Bakes the scratch strip, the feather sprite and the look sprites for a front canvas `w` wide. */
  bake(w: number): void;
  /**
   * One frame: every live drop in `drops` (clock seconds, -Infinity for none) draws its look, scaled by `amount` and
   * by that drop's own `power` (0 to 1, parallel to `drops`; 1 when left out). `look` is Tear (the default), Split, Roll or Flash.
   */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, nowS: number, drops: Float64Array, amount: number, src: GlitchSources, power?: Float64Array, look?: GlitchLook): void;
}

/** A repeatable pseudo random number in 0 to 1 from two numbers; pure arithmetic, no state. */
export function rnd(seed: number, i: number): number {
  const x = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const MAX_H = 20;

function slice(
  ctx: CanvasRenderingContext2D,
  buf: CanvasRenderingContext2D,
  bufEl: HTMLCanvasElement,
  feather: HTMLCanvasElement,
  from: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  dx: number,
  dy: number,
  tint: string,
  alpha: number,
): void {
  buf.globalCompositeOperation = 'source-over';
  buf.clearRect(0, 0, bufEl.width, MAX_H);
  buf.drawImage(from, sx, sy, sw, sh, 0, 0, dw, dh);
  // Tint only the slice (the buffer holds nothing else), then feather its ends and its top and bottom.
  buf.globalCompositeOperation = 'source-atop';
  buf.fillStyle = tint;
  buf.fillRect(0, 0, dw, dh);
  buf.globalCompositeOperation = 'destination-in';
  buf.drawImage(feather, 0, 0, dw, dh);
  ctx.globalAlpha = alpha > 1 ? 1 : alpha;
  ctx.drawImage(bufEl, 0, 0, dw, dh, dx, dy, dw, dh);
}

function set(ctx: CanvasRenderingContext2D, buf: CanvasRenderingContext2D, bufEl: HTMLCanvasElement, feather: HTMLCanvasElement, w: number, h: number, seed: number, weight: number, src: GlitchSources): void {
  for (let i = 0; i < SLICES; i++) {
    const r = rnd(seed, i);
    const sh = 3 + rnd(seed, i + 40) * (MAX_H - 3);
    const y = (0.08 + 0.86 * r) * (h - sh);
    const dx = (rnd(seed, i + 80) - 0.5) * 2 * (10 + 34 * rnd(seed, i + 120));
    const m = src.map;
    const bw = (0.3 + 0.5 * rnd(seed, i + 160)) * w;
    const bx = rnd(seed, i + 200) * (w - bw);
    if (src.hz) {
      slice(ctx, buf, bufEl, feather, src.hz, m.bx + bx * m.ax, y * m.ay + m.by, bw * m.ax, sh * m.ay, bw, sh, bx + dx, y, 'rgba(255,70,170,0.42)', weight * 0.5);
      slice(ctx, buf, bufEl, feather, src.hz, m.bx + bx * m.ax, y * m.ay + m.by, bw * m.ax, sh * m.ay, bw, sh, bx - dx * 0.6, y, 'rgba(70,220,255,0.38)', weight * 0.3);
    }
    const a = src.art;
    if (src.img && a.w > 0 && y + sh > a.y && y < a.y + a.h && src.img.naturalWidth > 0) {
      const ny = ((y - a.y) / a.h) * src.img.naturalHeight;
      const nh = (sh / a.h) * src.img.naturalHeight;
      if (ny >= 0 && ny + nh <= src.img.naturalHeight) slice(ctx, buf, bufEl, feather, src.img, 0, ny, src.img.naturalWidth, nh, a.w, sh, a.x + dx, y, 'rgba(255,90,190,0.35)', weight * 0.6);
    }
  }
}


/** The three looks other than Tear draw into one scratch layer the size of the sheet, which is faded in from the left edge and added over the scene. */
interface Fx {
  layer: HTMLCanvasElement;
  lctx: CanvasRenderingContext2D;
  tmp: HTMLCanvasElement;
  tctx: CanvasRenderingContext2D;
  /** A 256 by 1 strip: clear at the left edge, solid from about an eighth of the width on. */
  fade: HTMLCanvasElement;
  /** A soft light, 128 by 128, bright in the middle. */
  bloom: HTMLCanvasElement;
  /** A 1 by 64 strip: the tracking band's profile, clear at both ends and bright in the middle. */
  band: HTMLCanvasElement;
}

const MAGENTA = 'rgba(255,60,170,0.6)';
const CYAN = 'rgba(60,220,255,0.55)';
const WASH = 'rgba(255,236,222,1)';
const LINE = 'rgba(210,235,255,1)';
/** Where the left fade is solid, as a share of the width. */
export const FADE_IN = 0.12;

function size(c: HTMLCanvasElement, w: number, h: number): void {
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
}

/** Split, the channels: the picture's colour channels pull apart sideways. One pass for every live drop together (`e` is their summed strength). */
function splitChannels(fx: Fx, w: number, h: number, e: number, src: GlitchSources): void {
  const m = src.map;
  const pull = 6 + 40 * e;
  const l = fx.lctx;
  const t = fx.tctx;
  for (let c = 0; c < 2; c++) {
    const dir = c === 0 ? 1 : -1;
    t.globalCompositeOperation = 'source-over';
    t.globalAlpha = 1;
    t.clearRect(0, 0, w, h);
    if (src.hz) t.drawImage(src.hz, m.bx, m.by, w * m.ax, h * m.ay, dir * pull, 0, w, h);
    const a = src.art;
    if (src.img && a.w > 0 && src.img.naturalWidth > 0) t.drawImage(src.img, a.x + dir * pull, a.y, a.w, a.h);
    t.globalCompositeOperation = 'source-atop';
    t.fillStyle = c === 0 ? MAGENTA : CYAN;
    t.fillRect(0, 0, w, h);
    l.globalAlpha = Math.min(1, e * 0.9);
    l.drawImage(fx.tmp, 0, 0);
  }
}

/** Split, the bands: a few wide bands shake, per drop and seed. */
function splitBands(fx: Fx, w: number, h: number, e: number, weight: number, seed: number, src: GlitchSources): void {
  if (!src.hz) return;
  const m = src.map;
  const l = fx.lctx;
  for (let i = 0; i < 4; i++) {
    const bh = 22 + rnd(seed, i + 10) * 46;
    const y = (0.06 + 0.88 * rnd(seed, i)) * (h - bh);
    const dx = (rnd(seed, i + 20) - 0.5) * 2 * (30 + 60 * e);
    l.globalAlpha = Math.min(1, e * 0.5) * weight;
    l.drawImage(src.hz, m.bx, y * m.ay + m.by, w * m.ax, bh * m.ay, dx, y, w, bh);
  }
}

/** Roll: a tape tracking band rolls down the screen, its picture shifted and its lines noisy. */
function rollLook(fx: Fx, w: number, h: number, e: number, age: number, src: GlitchSources): void {
  const m = src.map;
  const l = fx.lctx;
  const t = fx.tctx;
  const bh = Math.max(40, h * 0.3);
  const p = sstep(0, 1, age / DROP_S);
  const y = -bh + (h + bh) * p;
  // The picture inside the band, pulled sideways, shaped by the band's own profile.
  t.globalCompositeOperation = 'source-over';
  t.globalAlpha = 1;
  t.clearRect(0, 0, w, h);
  if (src.hz) {
    const wob = Math.sin(age * 38) * 26 * e;
    t.drawImage(src.hz, m.bx, m.by, w * m.ax, h * m.ay, wob, 0, w, h);
  }
  t.globalCompositeOperation = 'destination-in';
  t.drawImage(fx.band, 0, y, w, bh);
  l.globalAlpha = Math.min(1, e * 0.9);
  l.drawImage(fx.tmp, 0, 0);
  // The band's own glow, and a few fine noise lines inside it.
  l.globalAlpha = Math.min(1, e * 1.1);
  l.drawImage(fx.band, 0, y, w, bh);
  l.fillStyle = LINE;
  const seed = Math.floor(age * 24);
  for (let i = 0; i < 6; i++) {
    const ly = y + rnd(seed, i) * bh;
    const lw = (0.25 + 0.6 * rnd(seed, i + 8)) * w;
    l.globalAlpha = Math.min(1, e * 0.45) * rnd(seed, i + 16);
    l.fillRect(rnd(seed, i + 24) * (w - lw), ly, lw, 2);
  }
}

/** Flash: a bright bloom and a small zoom punch. */
function flashLook(fx: Fx, w: number, h: number, e: number, src: GlitchSources): void {
  const m = src.map;
  const l = fx.lctx;
  l.globalAlpha = Math.min(1, e * 0.8);
  l.drawImage(fx.bloom, w * 0.5 - w * 0.75, h * 0.45 - h * 0.95, w * 1.5, h * 1.9);
  l.globalAlpha = Math.min(1, e * 0.1);
  l.fillStyle = WASH;
  l.fillRect(0, 0, w, h);
  if (src.hz) {
    const z = 1 + 0.045 * e;
    l.globalAlpha = Math.min(1, e * 0.4);
    l.drawImage(src.hz, m.bx, m.by, w * m.ax, h * m.ay, (w * (1 - z)) / 2, (h * (1 - z)) / 2, w * z, h * z);
  }
}

function drawLook(ctx: CanvasRenderingContext2D, fx: Fx, w: number, h: number, nowS: number, drops: Float64Array, amount: number, src: GlitchSources, power: Float64Array | undefined, look: GlitchLook): void {
  const l = fx.lctx;
  let any = false;
  let sum = 0;
  for (let d = 0; d < drops.length; d++) {
    const age = nowS - drops[d];
    if (!(age >= 0 && age < DROP_S)) continue;
    const e = envOf(age) * amount * (power ? power[d] : 1);
    if (e < 0.01) continue;
    if (!any) {
      size(fx.layer, w, h);
      size(fx.tmp, w, h);
      l.globalCompositeOperation = 'source-over';
      l.globalAlpha = 1;
      l.clearRect(0, 0, w, h);
      any = true;
    }
    l.globalCompositeOperation = 'source-over';
    if (look === 'split') {
      const phase = age * SEED_HZ;
      const k = Math.floor(phase);
      const f = sstep(0, 1, phase - k);
      const base = (drops[d] % 997) * 13;
      sum += e;
      splitBands(fx, w, h, e, 1 - f, base + k, src);
      splitBands(fx, w, h, e, f, base + k + 1, src);
    } else if (look === 'roll') rollLook(fx, w, h, e, age, src);
    else flashLook(fx, w, h, e, src);
  }
  if (!any) return;
  // Split pulls its channels once for all live drops together, not once per drop and seed.
  if (sum > 0) splitChannels(fx, w, h, Math.min(1, sum), src);
  // Fade in from the left edge (the rail side): the whole layer is multiplied by the strip, so no look starts with a hard edge.
  l.globalCompositeOperation = 'destination-in';
  l.globalAlpha = 1;
  l.drawImage(fx.fade, 0, 0, w, h);
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 1;
  ctx.drawImage(fx.layer, 0, 0);
}

function bakeFx(): Fx | null {
  const layer = document.createElement('canvas');
  const tmp = document.createElement('canvas');
  const fade = document.createElement('canvas');
  const bloom = document.createElement('canvas');
  const band = document.createElement('canvas');
  const lctx = layer.getContext('2d');
  const tctx = tmp.getContext('2d');
  const fg = fade.getContext('2d');
  const bg = bloom.getContext('2d');
  const ng = band.getContext('2d');
  if (!lctx || !tctx || !fg || !bg || !ng) return null;
  fade.width = 256;
  fade.height = 1;
  for (let x = 0; x < 256; x++) {
    fg.fillStyle = `rgba(0,0,0,${sstep(0, FADE_IN * 256, x).toFixed(3)})`;
    fg.fillRect(x, 0, 1, 1);
  }
  bloom.width = 128;
  bloom.height = 128;
  const rg = bg.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,244,232,0.95)');
  rg.addColorStop(0.35, 'rgba(255,200,170,0.5)');
  rg.addColorStop(0.7, 'rgba(255,140,190,0.16)');
  rg.addColorStop(1, 'rgba(255,140,190,0)');
  bg.fillStyle = rg;
  bg.fillRect(0, 0, 128, 128);
  band.width = 1;
  band.height = 64;
  for (let y = 0; y < 64; y++) {
    const v = sstep(0, 22, y) * sstep(0, 22, 63 - y);
    ng.fillStyle = `rgba(170,215,255,${(0.8 * v).toFixed(3)})`;
    ng.fillRect(0, y, 1, 1);
  }
  return { layer, lctx, tmp, tctx, fade, bloom, band };
}

/** Tear: slices torn from the horizon canvas and the art, per live drop, scaled by `amount` and the drop's own power. */
function tearDrops(ctx: CanvasRenderingContext2D, bctx: CanvasRenderingContext2D, buf: HTMLCanvasElement, feather: HTMLCanvasElement, w: number, h: number, nowS: number, drops: Float64Array, amount: number, src: GlitchSources, power: Float64Array | undefined): void {
  ctx.globalCompositeOperation = 'screen';
  for (let d = 0; d < drops.length; d++) {
    const age = nowS - drops[d];
    if (!(age >= 0 && age < DROP_S)) continue;
    const env = envOf(age) * amount * (power ? power[d] : 1);
    if (env < 0.01) continue;
    // Two seeds are alive at once and crossfade, per drop stamp, so the slices re-roll without a pop.
    const phase = age * SEED_HZ;
    const k = Math.floor(phase);
    const f = sstep(0, 1, phase - k);
    const base = (drops[d] % 997) * 13;
    set(ctx, bctx, buf, feather, w, h, base + k, env * (1 - f), src);
    set(ctx, bctx, buf, feather, w, h, base + k + 1, env * f, src);
  }
  ctx.globalAlpha = 1;
}

/** Seconds a look takes to fade out (and the next to fade in) when the Drop Glitch choice changes. */
export const LOOK_FADE_S = 0.25;

export function createGlitch(): Glitch {
  let buf: HTMLCanvasElement | null = null;
  let bctx: CanvasRenderingContext2D | null = null;
  let feather: HTMLCanvasElement | null = null;
  let fx: Fx | null = null;
  const wts = new Float64Array(4);
  let lastNow = -1;
  let seen = false;
  return {
    bake(w) {
      const b = document.createElement('canvas');
      b.width = Math.max(2, Math.round(w));
      b.height = MAX_H;
      buf = b;
      bctx = b.getContext('2d');
      const f = document.createElement('canvas');
      f.width = 64;
      f.height = 16;
      const g = f.getContext('2d');
      if (g) {
        // Alpha is a smooth step in from every edge: ends over 12 px of 64, top and bottom over 5 of 16.
        for (let x = 0; x < 64; x++) {
          const ex = sstep(0, 12, x) * sstep(0, 12, 63 - x);
          for (let y = 0; y < 16; y++) {
            g.fillStyle = `rgba(0,0,0,${(ex * sstep(0, 5, y) * sstep(0, 5, 15 - y)).toFixed(3)})`;
            g.fillRect(x, y, 1, 1);
          }
        }
      }
      feather = f;
      if (!fx) fx = bakeFx();
    },
    draw(ctx, w, h, nowS, drops, amount, src, power, look) {
      // A change of look during a drop never cuts: each look keeps a weight that eases to 1 for the chosen look and to 0
      // for the others over `LOOK_FADE_S`, so the outgoing look fades out (Off included) while the new one fades in.
      const idx = look === 'split' ? 1 : look === 'roll' ? 2 : look === 'flash' ? 3 : look === 'off' ? -1 : 0;
      const dt = lastNow < 0 ? 0 : Math.min(LOOK_FADE_S, Math.max(0, nowS - lastNow));
      lastNow = nowS;
      if (!seen) {
        seen = true;
        if (idx >= 0) wts[idx] = 1;
      }
      const step = dt / LOOK_FADE_S;
      for (let k = 0; k < 4; k++) {
        const to = k === idx ? 1 : 0;
        wts[k] += Math.max(-step, Math.min(step, to - wts[k]));
      }
      if (amount <= 0.003 || !buf || !bctx || !feather) return;
      for (let k = 0; k < 4; k++) {
        if (wts[k] <= 0.003) continue;
        if (k === 0) tearDrops(ctx, bctx, buf, feather, w, h, nowS, drops, amount * wts[0], src, power);
        else if (fx) drawLook(ctx, fx, w, h, nowS, drops, amount * wts[k], src, power, k === 1 ? 'split' : k === 2 ? 'roll' : 'flash');
      }
    },
  };
}
