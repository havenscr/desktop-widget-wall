import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordingContext } from './canvasStub';
import { dropBlobSprite } from './weatherFx';
import {
  MIST_REDRAW_S,
  NIGHT_DIM,
  RAMP_S,
  WX_REVIEW_T,
  createWeatherLayer,
  drawWeatherBack,
  drawWeatherMid,
  hasWeatherCache,
  parseWeatherReview,
  releaseWeather,
  setSkipBoxes,
  setWeatherTarget,
  snapWeather,
  stepWeather,
  weatherOn,
  type WeatherLayer,
  type WeatherInput,
} from './weatherLayer';

vi.setConfig({ testTimeout: 20_000 });

const RAIN: WeatherInput = { rain: true, rainLevel: 0, windy: false };
const DRY: WeatherInput = { rain: false, rainLevel: -1, windy: false };
const WINDY: WeatherInput = { rain: false, rainLevel: -1, windy: true };

interface Fake {
  canvas: HTMLCanvasElement;
  log: string[];
}

/** A layer whose offscreen canvases are recording fakes, in the order they are made (the veil, then the mist). */
function fakeLayer(): { layer: WeatherLayer; made: Fake[] } {
  const made: Fake[] = [];
  const layer = createWeatherLayer(() => {
    const { ctx, log } = recordingContext();
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    made.push({ canvas, log });
    return canvas;
  });
  return { layer, made };
}

const HY = 505;
const SCALE = 1;
const back = (ctx: CanvasRenderingContext2D, layer: WeatherLayer, t = 3, awake = 1, hy = HY) => drawWeatherBack(ctx, layer, t, hy, SCALE, 2560, 720, awake);
const mid = (ctx: CanvasRenderingContext2D, layer: WeatherLayer, t = 3, awake = 1, hy = HY) => drawWeatherMid(ctx, layer, t, hy, SCALE, 2560, 720, awake);
const redraws = (f: Fake) => f.log.filter((l) => l.startsWith('clearRect(')).length;

beforeEach(() => {
  dropBlobSprite();
  // The shared mist sprite is made with a real element: give it a context.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => recordingContext().ctx) as never);
});
afterEach(() => vi.restoreAllMocks());

describe('the ramp', () => {
  it('goes up over 8 seconds and down again, rain and wind each on their own', () => {
    const { layer } = fakeLayer();
    setWeatherTarget(layer, RAIN, false, true);
    expect(weatherOn(layer)).toBe(true);
    expect(layer.rain).toBe(0);
    for (let i = 0; i < 4 * 30; i++) stepWeather(layer, 1 / 30);
    expect(layer.rain).toBeCloseTo(0.5, 2);
    expect(layer.wind).toBe(0);
    for (let i = 0; i < 4 * 30 + 2; i++) stepWeather(layer, 1 / 30);
    expect(layer.rain).toBe(1);
    expect(RAMP_S).toBe(8);
    setWeatherTarget(layer, DRY, false, true);
    expect(weatherOn(layer)).toBe(true);
    for (let i = 0; i < 4 * 30; i++) stepWeather(layer, 1 / 30);
    expect(layer.rain).toBeCloseTo(0.5, 2);
    for (let i = 0; i < 4 * 30 + 2; i++) stepWeather(layer, 1 / 30);
    expect(layer.rain).toBe(0);
    expect(weatherOn(layer)).toBe(false);
    setWeatherTarget(layer, WINDY, false, true);
    for (let i = 0; i < 8 * 30 + 2; i++) stepWeather(layer, 1 / 30);
    expect(layer.wind).toBe(1);
    expect(layer.rain).toBe(0);
  });

  it('is off when both targets are 0 and both ramps are 0, and the Tools switch takes both targets to 0', () => {
    const { layer } = fakeLayer();
    expect(weatherOn(layer)).toBe(false);
    setWeatherTarget(layer, { rain: true, rainLevel: 1, windy: true }, false, false);
    expect(layer.rainTarget).toBe(0);
    expect(layer.windTarget).toBe(0);
    expect(weatherOn(layer)).toBe(false);
    setWeatherTarget(layer, { rain: true, rainLevel: 1, windy: true }, false, true);
    expect(layer.rainTarget).toBe(1);
    expect(layer.windTarget).toBe(1);
  });

  it('halves the rain at night and eases a change in strength instead of jumping', () => {
    const { layer } = fakeLayer();
    setWeatherTarget(layer, RAIN, true, true);
    expect(layer.dim).toBe(NIGHT_DIM);
    snapWeather(layer, 0);
    setWeatherTarget(layer, { rain: true, rainLevel: 1, windy: false }, false, true);
    expect(layer.dim).toBe(NIGHT_DIM);
    expect(layer.level).toBe(0);
    for (let i = 0; i < 30; i++) stepWeather(layer, 1 / 30);
    expect(layer.dim).toBeGreaterThan(NIGHT_DIM);
    expect(layer.dim).toBeLessThan(1);
    expect(layer.level).toBeGreaterThan(0);
    expect(layer.level).toBeLessThan(1);
  });

  it('runs the streaks and the mist faster in wind without a jump in their clocks', () => {
    const { layer } = fakeLayer();
    setWeatherTarget(layer, { rain: true, rainLevel: 0.5, windy: true }, false, true);
    let last = layer.rt;
    for (let i = 0; i < 8 * 30; i++) {
      stepWeather(layer, 1 / 30);
      expect(layer.rt - last).toBeLessThan((1 / 30) * 1.16);
      expect(layer.rt - last).toBeGreaterThan(0);
      last = layer.rt;
    }
    expect(layer.mt).toBeGreaterThan(layer.rt * 1.5);
  });
});

describe('what it draws', () => {
  it('draws nothing at all while off: no call, no cache', () => {
    const { layer, made } = fakeLayer();
    const { ctx, log } = recordingContext();
    back(ctx, layer);
    mid(ctx, layer);
    expect(log).toEqual([]);
    expect(made).toHaveLength(0);
    expect(hasWeatherCache(layer)).toBe(false);
  });

  it('draws the sky veil and the mist, each with one image, in back; the streaks and rings in mid', () => {
    const { layer } = fakeLayer();
    setWeatherTarget(layer, RAIN, false, true);
    snapWeather(layer, 3);
    const b = recordingContext();
    back(b.ctx, layer);
    expect(b.log.filter((l) => l.startsWith('drawImage(')).length).toBe(2);
    expect(b.log.filter((l) => l === 'stroke()')).toHaveLength(0);
    const m = recordingContext();
    mid(m.ctx, layer);
    expect(m.log.filter((l) => l === 'stroke()').length).toBeGreaterThan(30);
    expect(m.log.some((l) => l.startsWith('ellipse('))).toBe(true);
    // Light rain has no mist on the water: no image.
    expect(m.log.filter((l) => l.startsWith('drawImage('))).toHaveLength(0);
    setWeatherTarget(layer, { rain: true, rainLevel: 1, windy: false }, false, true);
    snapWeather(layer, 3);
    const h = recordingContext();
    mid(h.ctx, layer);
    expect(h.log.filter((l) => l.startsWith('drawImage(')).length).toBeGreaterThan(0);
  });

  it('draws the wind lines in back and the tufts in mid, also without rain', () => {
    const { layer, made } = fakeLayer();
    setWeatherTarget(layer, WINDY, false, true);
    snapWeather(layer, 3);
    let lines = 0;
    let specks = 0;
    for (let t = 1; t < 30; t += 1.9) {
      const b = recordingContext();
      back(b.ctx, layer, t);
      lines += b.log.filter((l) => l === 'stroke()').length;
      const m = recordingContext();
      mid(m.ctx, layer, t);
      specks += m.log.filter((l) => l.startsWith('fillRect(')).length;
      expect(m.log.filter((l) => l === 'stroke()')).toHaveLength(0);
    }
    expect(lines).toBeGreaterThan(0);
    expect(specks).toBeGreaterThan(0);
    expect(made).toHaveLength(0);
  });

  it('sets the transform first and leaves the opacity and the composite mode as they were', () => {
    const { layer } = fakeLayer();
    setWeatherTarget(layer, { rain: true, rainLevel: 1, windy: true }, false, true);
    snapWeather(layer, 3);
    for (const fn of [back, mid]) {
      const { ctx, log } = recordingContext();
      fn(ctx, layer);
      expect(log[0]).toBe('setTransform(1,0,0,1,0,0)');
      expect(log[log.length - 1]).toBe('globalCompositeOperation=source-over');
      expect(log[log.length - 2]).toBe('globalAlpha=1');
    }
  });

  it('is a function of time: the same moment gives the same calls in mid', () => {
    const { layer } = fakeLayer();
    setWeatherTarget(layer, { rain: true, rainLevel: 0.5, windy: true }, false, true);
    snapWeather(layer, 4.7);
    const a = recordingContext();
    const b = recordingContext();
    mid(a.ctx, layer, 4.7);
    mid(b.ctx, layer, 4.7);
    expect(a.log).toEqual(b.log);
  });

  it('draws nothing while idle (awake 0) and takes the idle fade into every opacity', () => {
    const { layer } = fakeLayer();
    setWeatherTarget(layer, RAIN, false, true);
    snapWeather(layer, 3);
    const idle = recordingContext();
    back(idle.ctx, layer, 3, 0);
    mid(idle.ctx, layer, 3, 0);
    expect(idle.log).toEqual([]);
    const half = recordingContext();
    mid(half.ctx, layer, 3, 0.5);
    expect(half.log).toContain('globalAlpha=0.5');
  });

  it('skips the box areas in mid and does not draw a streak or ring inside them', () => {
    const { layer } = fakeLayer();
    setWeatherTarget(layer, { rain: true, rainLevel: 1, windy: false }, false, true);
    snapWeather(layer, 3);
    setSkipBoxes(layer, { a: { boxes: [[-200, -200, 3000, 1200]] } });
    expect(layer.boxes.n).toBe(4);
    expect(layer.boxes.v).toEqual([-208, -208, 2808, 1008]);
    const m = recordingContext();
    mid(m.ctx, layer);
    expect(m.log.filter((l) => l.startsWith('moveTo('))).toHaveLength(0);
    expect(m.log.filter((l) => l.startsWith('ellipse('))).toHaveLength(0);
    setSkipBoxes(layer, { a: { clear: [[100, 100, 10, 10]] }, b: { boxes: [[0, 0, 5, 5]], clear: [[1, 2, 3, 4]] } });
    expect(layer.boxes.n).toBe(12);
    layer.noSkip = true;
    setSkipBoxes(layer, { a: { boxes: [[0, 0, 5, 5]] } });
    expect(layer.boxes.n).toBe(0);
  });
});

describe('the cached soft layers', () => {
  it('redraws the veil only when its strength, the horizon line or the size changes', () => {
    const { layer, made } = fakeLayer();
    setWeatherTarget(layer, RAIN, false, true);
    snapWeather(layer, 3);
    const { ctx } = recordingContext();
    back(ctx, layer, 3);
    const veil = made[0];
    expect(redraws(veil)).toBe(1);
    for (let i = 0; i < 20; i++) back(ctx, layer, 3 + i / 30);
    expect(redraws(veil)).toBe(1);
    // the ramp changes the opacity it is drawn with, not its cache
    layer.rain = 0.4;
    back(ctx, layer, 3.2);
    expect(redraws(veil)).toBe(1);
    // a new strength
    layer.level = 1;
    back(ctx, layer, 3.2);
    expect(redraws(veil)).toBe(2);
    // a new horizon line
    back(ctx, layer, 3.2, 1, 582);
    expect(redraws(veil)).toBe(3);
    // a new size
    drawWeatherBack(ctx, layer, 3.2, 582, 2, 5120, 1440, 1);
    expect(redraws(veil)).toBe(4);
    expect(veil.canvas.width).toBe(5120);
  });

  it('draws the mist cache again every 0.25 s and slides it with one image between', () => {
    const { layer, made } = fakeLayer();
    setWeatherTarget(layer, RAIN, false, true);
    snapWeather(layer, 3);
    const { ctx } = recordingContext();
    back(ctx, layer, 3);
    const mistCache = made[1];
    expect(redraws(mistCache)).toBe(1);
    // many frames inside the interval: no redraw
    for (let i = 1; i < 7; i++) {
      layer.mt += 1 / 30;
      back(ctx, layer, 3 + i / 30);
    }
    expect(redraws(mistCache)).toBe(1);
    // the interval passes
    layer.mt += 1 / 30;
    back(ctx, layer, 3 + MIST_REDRAW_S + 0.01);
    expect(redraws(mistCache)).toBe(2);
    // time running back (a review) redraws too
    back(ctx, layer, 1);
    expect(redraws(mistCache)).toBe(3);
  });

  it('slides the mist by 9 px a second between redraws', () => {
    const { layer } = fakeLayer();
    setWeatherTarget(layer, RAIN, false, true);
    snapWeather(layer, 3);
    const first = recordingContext();
    back(first.ctx, layer, 3);
    layer.mt += 0.2;
    const second = recordingContext();
    back(second.ctx, layer, 3.2);
    const x = (log: string[]) => Number(log.filter((l) => l.startsWith('drawImage('))[1].split(',')[1]);
    expect(x(second.log) - x(first.log)).toBeCloseTo(9 * 0.2, 3);
  });

  it('releases both caches when it turns off and makes none while off', () => {
    const { layer, made } = fakeLayer();
    setWeatherTarget(layer, RAIN, false, true);
    snapWeather(layer, 3);
    const { ctx } = recordingContext();
    back(ctx, layer, 3);
    expect(hasWeatherCache(layer)).toBe(true);
    setWeatherTarget(layer, DRY, false, true);
    for (let i = 0; i < 9 * 30; i++) stepWeather(layer, 1 / 30);
    expect(weatherOn(layer)).toBe(false);
    expect(hasWeatherCache(layer)).toBe(false);
    expect(made.map((m) => [m.canvas.width, m.canvas.height])).toEqual([[0, 0], [0, 0]]);
    const count = made.length;
    back(ctx, layer, 20);
    mid(ctx, layer, 20);
    expect(made).toHaveLength(count);
    releaseWeather(layer);
    expect(hasWeatherCache(layer)).toBe(false);
  });

  it('makes no cache for wind alone', () => {
    const { layer, made } = fakeLayer();
    setWeatherTarget(layer, WINDY, false, true);
    snapWeather(layer, 3);
    const { ctx } = recordingContext();
    back(ctx, layer, 3);
    expect(made).toHaveLength(0);
  });
});

describe('the review knobs', () => {
  it('freezes at 4.7 seconds unless ?wxt says another, and reads the no skip knob', () => {
    expect(WX_REVIEW_T).toBe(4.7);
    expect(parseWeatherReview('')).toEqual({ t: 4.7, noSkip: false });
    expect(parseWeatherReview('?wxt=9.5&wxnoskip=1')).toEqual({ t: 9.5, noSkip: true });
    expect(parseWeatherReview('?wxt=abc').t).toBe(4.7);
    expect(parseWeatherReview('?wxt=-3').t).toBe(4.7);
  });
});
