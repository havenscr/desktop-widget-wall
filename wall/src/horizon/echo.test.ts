import { describe, expect, it } from 'vitest';
import { CAMERAS, HOME_MORNING, settled, startGlide, stepGlide } from './cameras';
import { ECHO_FADE_S, ECHO_GATE_S, echoOptions, initialEchoGate, stepEchoFade, stepEchoGate } from './echo';

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

it('draws nothing when the fade is zero', () => {
  expect(echoOptions(CAMERAS.unwind, 0, 1, 0)).toBeNull();
});

it('opacity scales with loudness and with the fade', () => {
  const quiet = echoOptions(CAMERAS.unwind, 1, 0.1, 0)!.a;
  const loud = echoOptions(CAMERAS.unwind, 1, 0.9, 0)!.a;
  const half = echoOptions(CAMERAS.unwind, 0.5, 0.9, 0)!.a;
  expect(loud).toBeGreaterThan(quiet);
  expect(half).toBeCloseTo(loud / 2, 9);
  expect(loud).toBeLessThanOrEqual(CAMERAS.unwind.ea);
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

it('strength is exactly ea * fade * level, and zero loudness gives no ripple', () => {
  expect(echoOptions(CAMERAS.unwind, 0.5, 0.4, 0)!.a).toBeCloseTo(CAMERAS.unwind.ea * 0.5 * 0.4, 9);
  expect(echoOptions(CAMERAS.unwind, 1, 0, 0)).toBeNull();
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
