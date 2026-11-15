import type { SkyClaim } from './sky';
import {
  WALL_W,
  blobSprite,
  dimSky,
  drift,
  gusts,
  mist,
  rings,
  streaks,
  type DriftSet,
  type FxBoxes,
  type FxView,
  type GustSet,
  type MistSet,
  type RingSet,
  type StreakSet,
} from './weatherFx';

/**
 * The weather layer of the horizon: rain (a dimmer sky, mist behind the ridge, a few long streaks,
 * rings on the lake) and wind (rain that leans, pale lines across the sky, tufts along the shore).
 * It has no canvas, timer or React state of its own: `HorizonCanvas` steps it and draws it inside
 * its own frame. `drawWeatherBack` goes between the sky part and the ground part (the mountains and
 * the lake hide it), `drawWeatherMid` over the ground and the music lines, under every card.
 * Nothing is allocated in a frame: the option records, the cached colour and the two cached soft
 * layers are made when something they depend on changes, never per frame.
 */

/** Seconds a start or a stop of rain or wind takes (every opacity is multiplied by the ramp). */
export const RAMP_S = 8;
/** How often the cached mist layer is drawn again; between redraws it slides with one `drawImage`. */
export const MIST_REDRAW_S = 0.25;
/** The moment a review still freezes the layer at (seconds), unless `?wxt=` says another. */
export const WX_REVIEW_T = 4.7;
/** Rain while Watt sleeps (9:30 PM to 6:30 AM) is this fraction of its day strength. */
export const NIGHT_DIM = 0.5;
/** The mist moves this much faster in wind (26 px a second instead of 9). */
const WIND_MIST_RATE = 26 / 9;
/** Streaks fall this much faster in wind. */
const WIND_FALL_RATE = 1.15;
/** Degrees from vertical: rain, and rain in wind. */
const DEG_CALM = 12;
const DEG_WIND = 34;
/** A picture's box or a keep-clear card is grown by this much before streaks, rings and tufts avoid it. */
const SKIP_GROW = 8;
/** The mist cache covers this much above and below the horizon line (banks are up to 260 px tall), and this much beyond each side. */
const MIST_ABOVE = 300;
const MIST_BELOW = 70;
const MIST_PAD = 16;
const MIST_SPEED = 9;
const VIEW_ALL: FxView = { x: 0, w: WALL_W };

/** What the layer needs of the weather sense (`senseWeather`). */
export interface WeatherInput {
  rain: boolean;
  rainLevel: number;
  windy: boolean;
}

interface SoftCache {
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
}

export interface WeatherLayer {
  /** Makes an offscreen canvas (injected in tests). */
  make: () => HTMLCanvasElement;
  rainTarget: number;
  windTarget: number;
  levelTarget: number;
  dimTarget: number;
  /** The ramps, level and night strength as drawn: they move toward their targets, `RAMP_S` for a full step. */
  rain: number;
  wind: number;
  level: number;
  dim: number;
  /** The streaks' clock and the back mist's clock: they run faster in wind without a jump (integrated, never `t * speed`). */
  rt: number;
  mt: number;
  /** Seconds since the weather was last read for the target (the caller reads it about once a second). */
  since: number;
  /** Dev knob: no skip boxes. */
  noSkip: boolean;
  boxes: FxBoxes;
  streak: StreakSet;
  ring: RingSet;
  mistBack: MistSet;
  mistWater: MistSet;
  gust: GustSet;
  speck: DriftSet;
  streakKey: number;
  veil: SoftCache & { k: number; hy: number; w: number; h: number; scale: number };
  mistCache: SoftCache & { at: number; mt0: number; key: number; scale: number; w: number; h: number };
}

export function createWeatherLayer(make: () => HTMLCanvasElement = () => document.createElement('canvas')): WeatherLayer {
  const boxes: FxBoxes = { v: [], n: 0 };
  return {
    make,
    rainTarget: 0,
    windTarget: 0,
    levelTarget: 0.5,
    dimTarget: 1,
    rain: 0,
    wind: 0,
    level: 0.5,
    dim: 1,
    rt: 0,
    mt: 0,
    since: 1e9,
    noSkip: false,
    boxes,
    streak: { n: 0, seed: 400, lenA: 36, lenB: 64, speedA: 420, speedB: 520, deg: DEG_CALM, top: -70, bottom: 0, color: '', lw: 1, fade: 1, view: VIEW_ALL, boxes },
    ring: { n: 0, hy: 0, alpha: 0, lifeA: 1.5, lifeB: 2.3, fade: 1, view: VIEW_ALL, boxes },
    mistBack: { n: 0, seed: 300, yA: 0, yB: 0, wA: 700, wB: 1300, alpha: 0, speed: MIST_SPEED, fade: 1, view: VIEW_ALL, shift: MIST_PAD, margin: MIST_PAD },
    mistWater: { n: 5, seed: 600, yA: 0, yB: 0, wA: 700, wB: 1200, alpha: 0, speed: 6, fade: 1, view: VIEW_ALL, shift: 0, margin: 0 },
    gust: { n: 5, top: 0, bottom: 0, alpha: 0.24, fade: 1, view: VIEW_ALL },
    speck: { n: 7, yA: 0, yB: 0, fade: 1, view: VIEW_ALL, boxes },
    streakKey: -1,
    veil: { canvas: null, ctx: null, k: -1, hy: -1, w: 0, h: 0, scale: 0 },
    mistCache: { canvas: null, ctx: null, at: -1e9, mt0: 0, key: -1, scale: 0, w: 0, h: 0 },
  };
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const toward = (v: number, target: number, step: number): number => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

/** True while anything of the layer shows or is about to: either ramp above 0, or a target of 1. */
export function weatherOn(layer: WeatherLayer): boolean {
  return layer.rain > 0 || layer.rainTarget === 1 || layer.wind > 0 || layer.windTarget === 1;
}

/**
 * Point the layer at what the weather is now. `enabled` is the Tools switch; `night` halves the rain.
 * Without a fresh reading, or with the switch off, both targets are 0 and the ramps take it down.
 */
export function setWeatherTarget(layer: WeatherLayer, sense: WeatherInput, night: boolean, enabled: boolean): void {
  const rain = enabled && sense.rain;
  layer.rainTarget = rain ? 1 : 0;
  layer.windTarget = enabled && sense.windy ? 1 : 0;
  if (rain) {
    layer.levelTarget = sense.rainLevel < 0 ? 0.5 : sense.rainLevel;
    layer.dimTarget = night ? NIGHT_DIM : 1;
    // Rain that is not showing yet starts at its strength; only a change while it shows is eased.
    if (layer.rain === 0) {
      layer.level = layer.levelTarget;
      layer.dim = layer.dimTarget;
    }
  }
}

/** Move the ramps toward their targets by `dt` seconds and advance the two clocks; the layer going off lets its caches go. */
export function stepWeather(layer: WeatherLayer, dt: number): void {
  const step = dt / RAMP_S;
  layer.rain = toward(layer.rain, layer.rainTarget, step);
  layer.wind = toward(layer.wind, layer.windTarget, step);
  layer.level = toward(layer.level, layer.levelTarget, step);
  layer.dim = toward(layer.dim, layer.dimTarget, step);
  layer.rt += dt * lerp(1, WIND_FALL_RATE, layer.wind);
  layer.mt += dt * lerp(1, WIND_MIST_RATE, layer.wind);
  if (!weatherOn(layer)) releaseWeather(layer);
}

/** A frozen review still: every ramp at its target and both clocks at `t`. */
export function snapWeather(layer: WeatherLayer, t: number): void {
  layer.rain = layer.rainTarget;
  layer.wind = layer.windTarget;
  layer.level = layer.levelTarget;
  layer.dim = layer.dimTarget;
  layer.rt = t;
  layer.mt = t;
}

/** Let the two cached soft layers go (their canvases are emptied so the memory is returned at once). */
export function releaseWeather(layer: WeatherLayer): void {
  for (const c of [layer.veil, layer.mistCache]) {
    if (c.canvas) {
      c.canvas.width = 0;
      c.canvas.height = 0;
    }
    c.canvas = null;
    c.ctx = null;
  }
  layer.veil.k = -1;
  layer.mistCache.key = -1;
  layer.mistCache.at = -1e9;
}

/** True when a cache holds a canvas (tests). */
export function hasWeatherCache(layer: WeatherLayer): boolean {
  return layer.veil.canvas !== null || layer.mistCache.canvas !== null;
}

/** The boxes the layer keeps empty: every claim's picture boxes and keep-clear cards, grown, as one flat list. */
export function setSkipBoxes(layer: WeatherLayer, claims: Readonly<Record<string, SkyClaim>>): void {
  const b = layer.boxes;
  b.v.length = 0;
  if (!layer.noSkip) {
    for (const id in claims) {
      const c = claims[id];
      for (const list of [c.boxes, c.clear]) {
        if (!list) continue;
        for (const [x, y, w, h] of list) b.v.push(x - SKIP_GROW, y - SKIP_GROW, x + w + SKIP_GROW, y + h + SKIP_GROW);
      }
    }
  }
  b.n = b.v.length;
}

/** The streaks' colour for a level, made again only when the level (to 0.01) changes. */
function streakColor(layer: WeatherLayer): string {
  const key = Math.round(layer.level * 100);
  if (key !== layer.streakKey) {
    layer.streakKey = key;
    layer.streak.color = `rgba(175,215,250,${lerp(0.17, 0.22, layer.level).toFixed(3)})`;
  }
  return layer.streak.color;
}

/** An offscreen canvas of this size in `cache`, or false where none can be had. */
function ensure(layer: WeatherLayer, cache: SoftCache, w: number, h: number): boolean {
  if (!cache.canvas || !cache.ctx) {
    const c = layer.make();
    const x = c.getContext('2d');
    if (!x) return false;
    cache.canvas = c;
    cache.ctx = x;
  }
  if (cache.canvas.width !== w || cache.canvas.height !== h) {
    cache.canvas.width = w;
    cache.canvas.height = h;
  }
  return true;
}

/** The sky veil, drawn into its cache when its strength (to 0.01), the horizon line or the size changes. */
function refreshVeil(layer: WeatherLayer, hy: number, scale: number): boolean {
  const v = layer.veil;
  const k = Math.round(lerp(0.35, 0.7, layer.level) * layer.dim * 100);
  const h = Math.ceil(hy * scale);
  const w = Math.round(WALL_W * scale);
  if (v.canvas && v.k === k && v.hy === Math.round(hy) && v.w === w && v.h === h && v.scale === scale) return true;
  if (h < 1 || !ensure(layer, v, w, h)) return false;
  const x = v.ctx as CanvasRenderingContext2D;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, w, h);
  x.setTransform(scale, 0, 0, scale, 0, 0);
  dimSky(x, h / scale, k / 100);
  v.k = k;
  v.hy = Math.round(hy);
  v.w = w;
  v.h = h;
  v.scale = scale;
  return true;
}

/** The back mist banks at the clock `mt`, drawn into their cache once `MIST_REDRAW_S` has passed (or the level changed). */
function refreshMist(layer: WeatherLayer, t: number, mt: number, scale: number): boolean {
  const m = layer.mistCache;
  const level = Math.round(layer.level * 100);
  const key = level * 1000 + Math.round(layer.dim * 100);
  const w = Math.round((WALL_W + 2 * MIST_PAD) * scale);
  const h = Math.ceil((MIST_ABOVE + MIST_BELOW) * scale);
  const fresh = m.canvas !== null && m.key === key && m.scale === scale && m.w === w && m.h === h && t >= m.at && t - m.at < MIST_REDRAW_S;
  if (fresh) return true;
  const sprite = blobSprite();
  if (!sprite || !ensure(layer, m, w, h)) return false;
  const x = m.ctx as CanvasRenderingContext2D;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, w, h);
  x.setTransform(scale, 0, 0, scale, 0, 0);
  const s = layer.mistBack;
  s.n = Math.round(lerp(8, 12, layer.level));
  s.yA = MIST_ABOVE - 170;
  s.yB = MIST_ABOVE - 60;
  s.alpha = lerp(0.16, 0.24, layer.level) * layer.dim;
  s.fade = 1;
  mist(x, mt, s, sprite);
  x.globalAlpha = 1;
  m.key = key;
  m.scale = scale;
  m.w = w;
  m.h = h;
  m.at = t;
  m.mt0 = mt;
  return true;
}

/**
 * The back layer, between the sky part and the ground part: the dimmer sky, the mist behind the
 * ridge, the wind lines. `awake` is the horizon's idle fade (0 while the display is idle).
 */
export function drawWeatherBack(ctx: CanvasRenderingContext2D, layer: WeatherLayer, t: number, hy: number, scale: number, _width: number, _height: number, awake: number): void {
  if (!(awake > 0) || !weatherOn(layer)) return;
  const rainA = layer.rain * awake;
  const windA = layer.wind * awake;
  if (rainA <= 0 && windA <= 0) return;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  if (rainA > 0) {
    if (refreshVeil(layer, hy, scale) && layer.veil.canvas) {
      ctx.globalAlpha = rainA;
      ctx.drawImage(layer.veil.canvas, 0, 0, WALL_W, layer.veil.canvas.height / scale);
    }
    if (refreshMist(layer, t, layer.mt, scale) && layer.mistCache.canvas) {
      const m = layer.mistCache;
      ctx.globalAlpha = rainA;
      ctx.drawImage(m.canvas as HTMLCanvasElement, -MIST_PAD + MIST_SPEED * (layer.mt - m.mt0), Math.round((hy - MIST_ABOVE) * scale) / scale, WALL_W + 2 * MIST_PAD, MIST_ABOVE + MIST_BELOW);
    }
  }
  if (windA > 0) {
    const g = layer.gust;
    g.top = Math.max(110, hy - 260);
    g.bottom = hy - 70;
    g.fade = windA;
    gusts(ctx, t, g);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * The mid layer, over the ground part and the music lines (on the same canvas), under every card:
 * long streaks, rings on the lake, mist on the water in steady and heavy rain, and the wind's tufts.
 */
export function drawWeatherMid(ctx: CanvasRenderingContext2D, layer: WeatherLayer, t: number, hy: number, scale: number, _width: number, _height: number, awake: number): void {
  if (!(awake > 0) || !weatherOn(layer)) return;
  const rainA = layer.rain * awake;
  const windA = layer.wind * awake;
  if (rainA <= 0 && windA <= 0) return;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  const lv = layer.level;
  const dim = layer.dim;
  if (rainA > 0) {
    const s = layer.streak;
    s.n = Math.round(lerp(80, 220, lv) * dim);
    s.deg = lerp(DEG_CALM, DEG_WIND, layer.wind);
    s.bottom = hy + 6;
    s.fade = rainA;
    streakColor(layer);
    streaks(ctx, layer.rt, s);
    const r = layer.ring;
    r.n = Math.round(lerp(50, 130, lv) * dim);
    r.hy = hy;
    r.alpha = lerp(0.56, 0.64, lv);
    r.fade = rainA;
    rings(ctx, t, r);
    if (lv > 0.5) {
      const w = layer.mistWater;
      w.yA = hy + 6;
      w.yB = hy + 40;
      w.alpha = 0.09 * dim;
      w.fade = rainA;
      mist(ctx, t, w, blobSprite());
    }
  }
  if (windA > 0) {
    const d = layer.speck;
    // The brief's 456 to 492 on Unwind (hy 505): 49 to 13 px above the shore line on every camera.
    d.yA = hy - 49;
    d.yB = hy - 13;
    d.fade = windA;
    drift(ctx, t, d);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** Dev knobs in the address (development builds only): `?wxt=<seconds>` freezes the still's moment, `?wxnoskip=1` empties the skip boxes. */
export interface WeatherReview {
  t: number;
  noSkip: boolean;
}

export function parseWeatherReview(search: string): WeatherReview {
  const q = new URLSearchParams(search);
  const t = Number(q.get('wxt'));
  return { t: q.has('wxt') && Number.isFinite(t) && t >= 0 ? t : WX_REVIEW_T, noSkip: q.get('wxnoskip') === '1' };
}
