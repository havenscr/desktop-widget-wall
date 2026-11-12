import { describe, expect, it } from 'vitest';
import { CAMERAS, HOME_MORNING, settled, startGlide, stepGlide } from './cameras';
import {
  ECHO_FADE_S,
  ECHO_GATE_S,
  IDLE_ALPHA,
  IDLE_AMP,
  IDLE_RATE,
  createEchoSampler,
  echoOptions,
  echoRate,
  initialEchoGate,
  stepEchoFade,
  stepEchoGate,
  visualizerWeight,
} from './echo';
import { blendCamera } from './cameras';
import { spec } from './renderer';

it('takes ea, en, eamp and ecx from the camera preset, with hs 900 and the animation time', () => {
  for (const place of ['work', 'home', 'unwind'] as const) {
    const cam = CAMERAS[place];
    const e = echoOptions(cam, 1, 1, 2.5)!;
    expect(e).toMatchObject({ n: cam.en, amp: cam.eamp, cx: cam.ecx, hs: 900, t: 2.5 });
    expect(e.a).toBeCloseTo(cam.ea, 9);
  }
});

it('has the values from the concept demo', () => {
  expect(CAMERAS.unwind).toMatchObject({ ea: 0.9, en: 11, eamp: 34, ecx: 1330 });
  expect(CAMERAS.work).toMatchObject({ ea: 0.3, en: 3, eamp: 8, ecx: 1900 });
  expect(CAMERAS.home).toMatchObject({ ea: 0.22, en: 3, eamp: 6, ecx: 2300 });
});

it('draws nothing on Work and Home when the fade is zero (silent)', () => {
  expect(echoOptions(CAMERAS.work, 0, 1, 0)).toBeNull();
  expect(echoOptions(CAMERAS.home, 0, 1, 0)).toBeNull();
});

it('opacity scales with loudness and with the fade on Work and Home', () => {
  for (const cam of [CAMERAS.work, CAMERAS.home]) {
    const quiet = echoOptions(cam, 1, 0.1, 0)!.a;
    const loud = echoOptions(cam, 1, 0.9, 0)!.a;
    const half = echoOptions(cam, 0.5, 0.9, 0)!.a;
    expect(loud).toBeGreaterThan(quiet);
    expect(half).toBeCloseTo(loud / 2, 9);
    expect(loud).toBeLessThanOrEqual(cam.ea);
  }
});

describe('the Unwind visualizer', () => {
  it('Unwind is the visualizer, Work and Home are not', () => {
    expect(visualizerWeight(CAMERAS.unwind)).toBe(1);
    expect(visualizerWeight(CAMERAS.work)).toBe(0);
    expect(visualizerWeight(CAMERAS.home)).toBe(0);
    expect(visualizerWeight(HOME_MORNING)).toBe(0);
  });

  it('while playing the lines are at ea times the fade, with no loudness scaling, at full height', () => {
    for (const loud of [0, 0.2, 1]) {
      const e = echoOptions(CAMERAS.unwind, 1, loud, 3)!;
      expect(e.a).toBeCloseTo(0.9, 9);
      expect(e.amp).toBe(34);
      expect(e.n).toBe(11);
    }
    expect(echoRate(CAMERAS.unwind, 1)).toBe(1);
  });

  it('silent: the idle lines, at 0.45 of ea, 0.35 of eamp, on a clock slowed to the 0.12 drift', () => {
    const e = echoOptions(CAMERAS.unwind, 0, 0, 5)!;
    expect(e).not.toBeNull();
    expect(e.a).toBeCloseTo(0.9 * IDLE_ALPHA, 9);
    expect(e.amp).toBeCloseTo(34 * IDLE_AMP, 9);
    expect(e).toMatchObject({ n: 11, cx: 1330, hs: 900, t: 5 });
    expect(e.sample).toBeUndefined();
    expect(echoRate(CAMERAS.unwind, 0) * 0.3).toBeCloseTo(0.12, 9);
    expect(IDLE_RATE).toBe(0.4);
    // Work and Home stay at full speed whatever the fade.
    expect(echoRate(CAMERAS.work, 0)).toBe(1);
    expect(echoRate(CAMERAS.home, 0.5)).toBe(1);
  });

  it('idle to playing and back moves every number smoothly (no step larger than the fade step)', () => {
    let prev = echoOptions(CAMERAS.unwind, 0, 0.3, 0)!;
    for (let f = 0.02; f <= 1.0001; f += 0.02) {
      const e = echoOptions(CAMERAS.unwind, f, 0.3, 0)!;
      expect(Math.abs(e.a - prev.a)).toBeLessThan(0.02);
      expect(Math.abs(e.amp - prev.amp)).toBeLessThan(0.5);
      prev = e;
    }
  });

  it('a glide from Work to Unwind eases the idle lines in rather than switching them on', () => {
    const out: number[] = [];
    for (let k = 0; k <= 50; k++) out.push(echoOptions(blendCamera(CAMERAS.work, CAMERAS.unwind, k / 50), 0, 0, 0)?.a ?? 0);
    expect(out[0]).toBe(0);
    expect(out[50]).toBeCloseTo(0.9 * IDLE_ALPHA, 9);
    for (let i = 1; i < out.length; i++) expect(Math.abs(out[i] - out[i - 1])).toBeLessThan(0.05);
  });

  it('the gate takes everything away, the idle lines included', () => {
    expect(echoOptions(CAMERAS.unwind, 0, 0, 0, 0)).toBeNull();
    expect(echoOptions(CAMERAS.unwind, 1, 1, 0, 0)).toBeNull();
    expect(echoOptions(CAMERAS.unwind, 0, 0, 0, 0.5)!.a).toBeCloseTo(0.9 * IDLE_ALPHA * 0.5, 9);
  });

  it('the sampler reads the band history at the line\'s age, and mixes in spec() by 1 - w', () => {
    const ages: number[] = [];
    const s = createEchoSampler((u, age) => {
      ages.push(age);
      return u * 10;
    });
    s.t = 20;
    s.w = 1;
    expect(s.sample(0.5, 17)).toBe(5);
    expect(ages).toEqual([3]);
    s.w = 0.25;
    expect(s.sample(0.5, 17)).toBeCloseTo(0.25 * 5 + 0.75 * spec(0.5, 17), 9);
  });
});

it('rounds a blended line count', () => {
  expect(echoOptions({ ...CAMERAS.unwind, en: 6.6 }, 1, 1, 0)!.n).toBe(7);
});

it('fades in and out over about a second', () => {
  let f = 0;
  for (let i = 0; i < 5; i++) f = stepEchoFade(f, true, ECHO_FADE_S / 10);
  expect(f).toBeCloseTo(0.5, 9);
  expect(stepEchoFade(0, true, 5)).toBe(1);
  expect(stepEchoFade(1, false, ECHO_FADE_S / 4)).toBeCloseTo(0.75, 9);
  expect(stepEchoFade(0.1, false, 5)).toBe(0);
});

it('strength on Work and Home is exactly ea * fade * level, and zero loudness gives no ripple', () => {
  expect(echoOptions(CAMERAS.work, 0.5, 0.4, 0)!.a).toBeCloseTo(CAMERAS.work.ea * 0.5 * 0.4, 9);
  expect(echoOptions(CAMERAS.work, 1, 0, 0)).toBeNull();
});

describe('the camera gate', () => {
  it('ramps out over the first 0.6 s of a move to Rainier and stays shut there', () => {
    let g = startGlide(settled(CAMERAS.work), HOME_MORNING, false, true);
    let gate = initialEchoGate(settled(CAMERAS.work));
    expect(gate).toBe(1);
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      g = stepGlide(g, 0.1);
      gate = stepEchoGate(gate, g, 0.1);
      seen.push(gate);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThan(seen[i - 1]);
    expect(seen[0]).toBeCloseTo(1 - 0.1 / ECHO_GATE_S, 9);
    expect(seen[4]).toBeGreaterThan(0); // still ramping at 0.5 s
    expect(seen[5]).toBeLessThan(1e-9); // gone by 0.6 s
    g = stepGlide(g, 10);
    expect(stepEchoGate(1, g, 0.1)).toBe(0); // the Rainier camera is the view: never drawn
    expect(initialEchoGate(settled(HOME_MORNING))).toBe(0);
  });

  it('stays shut while the turn away runs, then ramps in over 0.6 s once it settles', () => {
    let g = startGlide(settled(HOME_MORNING), CAMERAS.home, false);
    let gate = 0;
    for (let i = 0; i < 31; i++) {
      g = stepGlide(g, 0.1);
      gate = stepEchoGate(gate, g, 0.1);
      expect(gate).toBe(0);
    }
    const ramp: number[] = [];
    for (let i = 0; i < 7; i++) {
      g = stepGlide(g, 0.1);
      gate = stepEchoGate(gate, g, 0.1);
      ramp.push(gate);
    }
    expect(g.progress).toBe(1);
    expect(ramp[0]).toBeCloseTo(0.1 / ECHO_GATE_S, 9); // the arrival frame
    for (let i = 1; i < 6; i++) expect(ramp[i]).toBeGreaterThan(ramp[i - 1]);
    expect(ramp[5]).toBeCloseTo(1, 9);
    expect(ramp[6]).toBe(1);
  });

  it('stays open on moves between cameras that both have a ripple', () => {
    let g = startGlide(settled(CAMERAS.work), CAMERAS.unwind, false);
    for (let i = 0; i < 20; i++) {
      g = stepGlide(g, 0.1);
      expect(stepEchoGate(1, g, 0.1)).toBe(1);
    }
  });

  it('the gate scales the ripple through the fade argument', () => {
    expect(echoOptions(CAMERAS.home, 0.5, 1, 0)!.a).toBeCloseTo(CAMERAS.home.ea * 0.5, 9);
    expect(echoOptions(CAMERAS.home, 0, 1, 0)).toBeNull();
  });
});
