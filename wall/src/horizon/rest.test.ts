import { describe, expect, it } from 'vitest';
import { draw, when, type HorizonDrawOptions, type HorizonEcho } from './renderer';
import { CAMERAS, type CameraPreset } from './cameras';
import { echoPaths, frameGap, pathContext, type PathFill, type PathStroke } from './canvasStub';
import {
  DRIFT_SPEED,
  REST_LOOK,
  REST_LOOKS,
  REST_OPACITY,
  REST_PHASE,
  createEchoMotion,
  echoOptions,
  stepEchoMotion,
  type RestLook,
} from './echo';

/* The ridgelines' rest state, measured on the renderer's real output: a context that keeps every
   stroked path's points, opacity and width. The panorama's lines have N = 1281 points; the first
   such stroke is the range's own rim line and the last the mid layer's, so the echo lines are the
   ones between (the review frames are at night, where no sun highlight is stroked). */

const N = 1281;

function record(o: HorizonDrawOptions): { strokes: PathStroke[]; fills: PathFill[] } {
  const { ctx, strokes, fills } = pathContext();
  draw(ctx, o);
  return { strokes, fills };
}

const MS = when(2026, 11, 11, 21.7);

function options(cam: CameraPreset, echo: HorizonEcho | null, t = 2.5): HorizonDrawOptions {
  return { W: 2560, H: 720, scale: 1, hy: cam.hy, az0: cam.az0, ppd: cam.ppd, vex: cam.vex, snowDeg: cam.snowDeg, cityScale: cam.cs, vx: cam.vx, ms: MS, t, phase: 0.4, grain: false, echo };
}

/** The rim line's heights above the horizon (the range's outline, cr) and the echo lines'. */
function lines(cam: CameraPreset, echo: HorizonEcho | null, t = 2.5) {
  const { strokes, fills } = record(options(cam, echo, t));
  const { rim, echo: echoLines } = echoPaths(strokes, cam.hy);
  // Fills of the echo layers: closed paths of N + 2 points (the two horizon corners), in the echo block.
  const layerFills = fills.filter((f) => f.n === N + 2);
  return { rim, echo: echoLines, layerFills };
}

/** The echo at rest for a camera and look, on the resting phase. */
function restAt(cam: CameraPreset, look: RestLook = REST_LOOK, op = REST_OPACITY): HorizonEcho {
  const e = echoOptions(cam, 0, 2.5, 1, 1, look, op)!;
  e.drift = REST_PHASE;
  return e;
}

const close = (a: number[], b: number[], digits = 6) => {
  expect(a.length).toBe(b.length);
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  expect(worst).toBeLessThan(10 ** -digits);
};

describe('the resting looks (end states)', () => {
  const cam = CAMERAS.unwind;
  const n = cam.en;

  it('the setting: one named look, contours by default (the owner picked A), at opacity 0.22', () => {
    expect(REST_LOOK).toBe('contours');
    expect(REST_OPACITY).toBe(0.22);
    expect([...REST_LOOKS]).toEqual(['contours', 'levels', 'haze', 'ridge']);
  });

  it('contours: each line is the range outline scaled to an evenly spaced level, the top one the ridge itself', () => {
    const { rim, echo } = lines(cam, restAt(cam, 'contours'));
    expect(echo).toHaveLength(n);
    echo.forEach((l, j) => {
      close(l.h, rim.map((v) => (v * (n - j)) / n));
      const q = 1 - j / (n - 1);
      expect(l.alpha).toBeCloseTo(REST_OPACITY * (0.55 + 0.45 * q), 6);
      expect(l.width).toBe(1);
    });
  });

  it('contours on Work and Home: three still lines at the same opacity, levels 1, 2/3 and 1/3', () => {
    for (const c of [CAMERAS.work, CAMERAS.home]) {
      const { rim, echo } = lines(c, restAt(c, 'contours'));
      expect(echo).toHaveLength(3);
      echo.forEach((l, j) => close(l.h, rim.map((v) => (v * (3 - j)) / 3)));
      expect(echo[0].alpha).toBeCloseTo(REST_OPACITY, 6);
    }
  });

  it('levels: flat, slightly bowed lines that stay inside the mountain, the top one following the ridge', () => {
    const { rim, echo } = lines(cam, restAt(cam, 'levels'));
    expect(echo).toHaveLength(n);
    const cmax = Math.max(...rim);
    echo.forEach((l, j) => {
      const kc = n - 1 - j;
      const level = cmax * ((0.92 * 150) / (0.641 * 150)) * ((kc + 1) / (n + 0.6));
      for (let i = 0; i < N; i++) {
        const bow = ((2.5 * cmax) / (0.641 * 150)) * Math.sin((Math.PI * i * 2) / 2560) * (kc / n);
        expect(l.h[i]).toBeCloseTo(Math.min(rim[i], level + bow), 6);
      }
    });
    // The top line sits on the ridge everywhere.
    close(echo[0].h, rim);
  });

  it('haze: the lowest line is the range outline, the others rise behind it, each fainter; no fills paint the sky', () => {
    const plain = lines(cam, null);
    const { rim, echo, layerFills } = lines(cam, restAt(cam, 'haze'));
    expect(echo).toHaveLength(n);
    close(echo[n - 1].h, rim);
    expect(Math.max(...echo[0].h)).toBeGreaterThan(Math.max(...rim) * 1.3);
    for (let j = 1; j < n; j++) expect(echo[j].alpha).toBeGreaterThan(echo[j - 1].alpha);
    expect(layerFills.length).toBe(plain.layerFills.length);
  });

  it('ridge: one glowing line on the ridge and two faint lines just under it; the rest are not drawn, nor any fills', () => {
    const plain = lines(cam, null);
    const { rim, echo, layerFills } = lines(cam, restAt(cam, 'ridge'));
    // The glow (a wide faint stroke) and the ridge line, then the two lines under it.
    expect(echo).toHaveLength(4);
    const [glow, top, under1, under0] = echo;
    close(glow.h, rim);
    close(top.h, rim);
    expect(top.alpha).toBeCloseTo(REST_OPACITY * 2.4, 6);
    expect(top.width).toBeCloseTo(1.8, 9);
    expect(glow.width).toBeCloseTo(5.8, 9);
    expect(glow.alpha).toBeCloseTo(top.alpha * 0.3, 6);
    const vu = Math.max(...rim) / (0.641 * 150);
    close(under1.h, rim.map((v) => Math.max(0, v - 7 * vu)));
    close(under0.h, rim.map((v) => Math.max(0, v - 14 * vu)));
    expect(under1.alpha).toBeCloseTo(REST_OPACITY * 0.45, 6);
    expect(layerFills.length).toBe(plain.layerFills.length);
  });

  it('the resting opacity is one number: "B at 15" draws the same shapes at 0.15', () => {
    const at22 = lines(cam, restAt(cam, 'levels'));
    const at15 = lines(cam, restAt(cam, 'levels', 0.15));
    at15.echo.forEach((l, j) => {
      close(l.h, at22.echo[j].h);
      expect(l.alpha).toBeCloseTo((at22.echo[j].alpha * 0.15) / 0.22, 6);
    });
  });
});

/**
 * A slow, smooth stand-in for the bands, so a frame-to-frame move measures the settle and the drift
 * rather than the beat (the made-up spectrum's kick moves a line about 25 px in one frame).
 */
const SLOW = (u: number, tau: number) => 0.6 + 0.3 * Math.sin(u * 6 + tau * 0.5);

/**
 * Frames of the echo at 30 fps through the canvas's own steps: each phase drives or not for so many
 * seconds. `SLOW` stands in for the bands.
 */
function run(cam: CameraPreset, startAtRest: boolean, phases: [boolean, number][]) {
  const m = createEchoMotion(startAtRest);
  const out: { rest: number; drift: number; echo: ReturnType<typeof lines>['echo'] }[] = [];
  let T = 0;
  for (const [driving, seconds] of phases) {
    for (let f = 0; f < Math.round(seconds * 30); f++) {
      T += 1 / 30;
      stepEchoMotion(m, driving, 1 / 30);
      const e = echoOptions(cam, 1, T, 1, m.rest)!;
      e.drift = m.drift;
      e.sample = SLOW;
      out.push({ rest: m.rest, drift: m.drift, echo: lines(cam, e, T).echo });
    }
  }
  return out;
}

/**
 * The largest per-frame move of any visible line: each line is matched to the nearest line of the
 * frame before (lines are interchangeable as the drift carries them along); a line with no near
 * match must be nearly invisible (it is fading in at an end of the drift).
 */
function largestMove(frames: ReturnType<typeof run>, from: number, to: number, popAlpha = 0.03) {
  let worst = 0;
  let worstAlphaStep = 0;
  for (let k = Math.max(1, from); k < to; k++) {
    for (const l of frames[k].echo) {
      let best = Infinity;
      let bestAlpha = 0;
      for (const p of frames[k - 1].echo) {
        let d = 0;
        for (let i = 0; i < N; i += 4) d = Math.max(d, Math.abs(l.h[i] - p.h[i]));
        if (d < best) {
          best = d;
          bestAlpha = p.alpha;
        }
      }
      if (l.alpha < popAlpha) continue;
      worst = Math.max(worst, best);
      worstAlphaStep = Math.max(worstAlphaStep, Math.abs(l.alpha - bestAlpha));
    }
  }
  return { worst, worstAlphaStep };
}

describe('settle and lift (Unwind)', () => {
  const cam = CAMERAS.unwind;
  const n = cam.en;

  it('the settle is continuous, no faster than the playing lines move, and ends exactly on the contour levels, then holds still', () => {
    const frames = run(cam, false, [
      [true, 3],
      [false, 4],
    ]);
    const playing = largestMove(frames, 30, 90);
    const settle = largestMove(frames, 90, frames.length);
    // Measured: playing 0.82 px, settle 1.08 px, opacity 0.026 at most in one frame.
    expect(settle.worst).toBeLessThan(2 * Math.max(1, playing.worst)); // design pixels in one frame
    expect(settle.worst).toBeLessThan(2);
    expect(settle.worstAlphaStep).toBeLessThan(0.06);
    // Exactly 2.5 s (75 frames) after the music stops: at rest, on the resting phase.
    expect(frames[90 + 74].rest).toBe(1);
    expect(frames[90 + 73].rest).toBeLessThan(1);
    const { rim } = lines(cam, null);
    const end = frames[frames.length - 1].echo;
    expect(end).toHaveLength(n);
    end.forEach((l, j) => close(l.h, rim.map((v) => (v * (n - j)) / n)));
    // Still: every frame after the settle draws the same lines.
    for (let k = 90 + 75; k < frames.length; k++) {
      expect(frames[k].drift).toBe(REST_PHASE);
      frames[k].echo.forEach((l, j) => {
        expect(l.h).toEqual(end[j].h);
        expect(l.alpha).toBe(end[j].alpha);
      });
    }
  });

  it('the lift is continuous and reaches the live lines in 1.5 s', () => {
    const frames = run(cam, true, [
      [false, 0.5],
      [true, 3],
    ]);
    const lift = largestMove(frames, 15, frames.length);
    expect(lift.worst).toBeLessThan(2);
    expect(lift.worstAlphaStep).toBeLessThan(0.06);
    expect(frames[15 + 44].rest).toBe(0);
    expect(frames[15 + 43].rest).toBeGreaterThan(0);
  });

  it('a settle interrupted by the music returning, and a lift interrupted by it stopping, stay continuous', () => {
    const frames = run(cam, false, [
      [true, 2],
      [false, 1],
      [true, 0.5],
      [false, 3],
    ]);
    const all = largestMove(frames, 30, frames.length);
    expect(all.worst).toBeLessThan(2);
    expect(all.worstAlphaStep).toBeLessThan(0.06);
    expect(frames[frames.length - 1].rest).toBe(1);
  });
});

describe('the motion stepper', () => {
  it('settling: the drift slows from the playing speed to a stop exactly on the resting phase, never running backward', () => {
    for (const start of [0, 0.2, 0.49, 0.5, 0.51, 0.9, 0.999]) {
      const m = createEchoMotion(false);
      m.drift = start;
      let prev = start;
      let moved = 0;
      let lastStep = DRIFT_SPEED / 30;
      for (let f = 0; f < 120; f++) {
        stepEchoMotion(m, false, 1 / 30);
        let step = m.drift - prev;
        if (step < -0.5) step += 1; // wrapped past 1
        expect(step).toBeGreaterThanOrEqual(-1e-12);
        expect(step).toBeLessThan(0.6 / 30 * 2);
        // Speed changes smoothly: no frame-to-frame jump in speed bigger than a small share.
        expect(Math.abs(step - lastStep)).toBeLessThan(0.004);
        lastStep = step;
        moved += step;
        prev = m.drift;
      }
      expect(m.rest).toBe(1);
      expect(m.drift).toBe(REST_PHASE);
      expect(moved).toBeLessThanOrEqual(1.25 + 1e-9);
    }
  });

  it('lifting: the drift speeds up from still to the playing speed as rest falls to 0', () => {
    const m = createEchoMotion(true);
    const speeds: number[] = [];
    for (let f = 0; f < 60; f++) {
      stepEchoMotion(m, true, 1 / 30);
      speeds.push(m.v);
    }
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeGreaterThanOrEqual(speeds[i - 1]);
    expect(speeds[0]).toBeCloseTo(DRIFT_SPEED / 45, 9);
    expect(speeds[59]).toBe(DRIFT_SPEED);
    expect(m.rest).toBe(0);
  });

  it('a settle that starts right after a lift began eases back to the resting phase behind instead of racing ahead', () => {
    const m = createEchoMotion(true);
    for (let f = 0; f < 3; f++) stepEchoMotion(m, true, 1 / 30);
    const at = m.drift;
    expect(at).toBeGreaterThan(REST_PHASE);
    stepEchoMotion(m, false, 1 / 30);
    expect(m.to).toBe(REST_PHASE);
    for (let f = 0; f < 30; f++) stepEchoMotion(m, false, 1 / 30);
    expect(m.drift).toBe(REST_PHASE);
  });
});

describe('a blended line count (a glide between cameras)', () => {
  const cam = CAMERAS.unwind;
  const at = (count: number, rest: number) => {
    const e = echoOptions({ ...cam, en: count }, 1, 2.5, 1, rest)!;
    e.drift = rest >= 1 ? REST_PHASE : 0.3;
    return lines(cam, e).echo;
  };

  for (const rest of [1, 0.5, 0]) {
    it(`crosses every half and whole count with no line appearing, vanishing or jumping (rest ${rest})`, () => {
      for (let k = 3; k <= 10; k++) {
        for (const c of [k + 0.5, k + 1]) {
          const g = frameGap(at(c - 0.01, rest), at(c + 0.01, rest), 0.01);
          expect(g.worst).toBeLessThan(1);
          expect(g.alpha).toBeLessThan(0.02);
        }
      }
    });
  }

  it('a whole count draws one set exactly as before; a fractional one crossfades the two whole sets either side, each on its own levels', () => {
    const one = at(7, 1);
    expect(one).toHaveLength(7);
    const both = at(7.25, 1);
    expect(both).toHaveLength(15);
    const { rim } = lines(cam, null);
    both.slice(0, 7).forEach((l, j) => {
      close(l.h, rim.map((v) => (v * (7 - j)) / 7));
      expect(l.alpha).toBeCloseTo(one[j].alpha * 0.75, 6);
    });
    both.slice(7).forEach((l, j) => close(l.h, rim.map((v) => (v * (8 - j)) / 8)));
  });
});

describe('at rest nothing follows time', () => {
  it('the rest frame draws identical lines at any time', () => {
    const cam = CAMERAS.unwind;
    const a = lines(cam, restAt(cam), 2.5).echo;
    const b = lines(cam, { ...restAt(cam), t: 913.7 }, 913.7).echo;
    expect(b).toEqual(a);
  });
});

